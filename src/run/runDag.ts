/**
 * runDag — execute a user-authored dagonizer DAG bundle from `.dag.jsonld` + `.state.json`.
 *
 * A scrape run in the native-DAG model consists of two files:
 *   - A `.dag.jsonld` containing either a single dagonizer DAG document
 *     (plain JSON object) or a bundle (JSON array of DAG documents). When a
 *     bundle, every element is exactly what `DAGDocument.serialize` emits for
 *     one DAG.
 *   - A `.state.json` containing run params validated against `RunStateSchema`,
 *     used to build services (cache, scrapers, output dir, …).
 *
 * The entry point `runDagFromFiles` reads both files and delegates to the
 * testable `runDag` core. `PluginLoader.registerFromDags` discovers which plugin
 * node modules the DAG bundle references and registers them automatically.
 *
 * Multi-DAG bundles: `runDag` discovers the root DAG (the one not referenced
 * by any other via `EmbeddedDAGNode.dag` or `ScatterNode.body.dag`), registers
 * DAGs in dependency order (leaves first, root last), and dispatches the root.
 *
 * Worker-pool execution (WorkerThreadContainer) is deferred to Wave 3 — this
 * wave runs everything in-process. See TODO comment in `runDag`.
 *
 * @module run/runDag
 * @since 2.7.0
 */

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve }                    from 'node:path';

import { DAGDocument }                from '@studnicky/dagonizer';
import type { DAGType, DagonizerInterface } from '@studnicky/dagonizer';

import { RipperDagonizer }            from '../dispatcher/RipperDagonizer.js';
import { Logger }                     from '../modules/logger/logger.js';
import { ScraperCache }               from '../modules/cache/ScraperCache.js';
import { HtmlScraper }                from '../scrapers/HtmlScraper.js';
import { MediaWikiScraper }           from '../scrapers/MediaWikiScraper.js';
import { ScrapeState }                from '../state/ScrapeState.js';
import { RunStateSchema }             from '../schemas/internal/RunStateSchema.js';
import type { RunStateType }          from '../types/RunState.js';
import type { RipperServices }        from '../services/RipperServices.js';
import type {
  FailuresManifestType,
  RunDagFromFilesOptionsType,
  RunDagOptionsType,
}                                     from '../types/RipperRun.js';

import { PluginLoader }               from './PluginLoader.js';

export type { RunDagFromFilesOptionsType, RunDagOptionsType };

// ── Constants ──────────────────────────────────────────────────────────────────

const log = Logger.forComponent('runDag');

// ── runDagFromFiles ────────────────────────────────────────────────────────────

/**
 * Read `dagPath` and `statePath` from disk, validate, then execute via `runDag`.
 *
 * `dagPath` is parsed as JSON. When the result is an array, each element is
 * validated via `DAGDocument.ofValue`; when it is a plain object, it is
 * validated via `DAGDocument.ofValue` and wrapped in a one-element array.
 * `statePath` is validated against `RunStateSchema`; throws with a clear message
 * on failure.
 *
 * @param opts - File paths and output/config directories.
 * @returns Resolves after the DAG bundle completes and the failures manifest
 *   (if any) is written.
 *
 * @category Orchestrators
 * @since 2.7.0
 */
export async function runDagFromFiles(opts: RunDagFromFilesOptionsType): Promise<void> {
  const dagJson    = await readFile(opts.dagPath,   'utf-8');
  const stateJson  = await readFile(opts.statePath, 'utf-8');

  const dagParsed  = JSON.parse(dagJson) as unknown;
  const rawState   = JSON.parse(stateJson) as unknown;
  const stateError = RunStateSchema.validate(rawState);

  if (stateError !== null) {
    throw new Error(
      `Invalid run-state file at ${opts.statePath}:\n  ${stateError}`,
    );
  }

  // Normalise to an array of DAGType regardless of whether the file contains a
  // single document (object) or a bundle (array).
  let dags: DAGType[];
  if (Array.isArray(dagParsed)) {
    dags = dagParsed.map((dagEl) => DAGDocument.ofValue(dagEl));
  } else {
    dags = [DAGDocument.ofValue(dagParsed)];
  }

  await runDag({
    dags,
    state:     rawState as RunStateType,
    outDir:    opts.outDir,
    configDir: opts.configDir,
  });
}

// ── runDag ─────────────────────────────────────────────────────────────────────

/**
 * Execute a dagonizer DAG bundle driven by validated run params.
 *
 * Construction order:
 *   1. Build `cache`, `htmlScraper`, `wikiScraper` from `state` params.
 *   2. `mkdir` the output directory.
 *   3. Construct `RipperDagonizer` with the proxy-services pattern.
 *   4. Build the `RipperServices` bag; wire `holder.current`.
 *   5. `PluginLoader.registerBuiltinNodes` + `PluginLoader.registerFromDags`
 *      (discovers plugin modules referenced by any DAG in the bundle).
 *   6. Determine the root DAG via `rootDagName`, topologically sort the bundle
 *      (leaves first, root last), and call `dispatcher.registerDAG` for each.
 *   7. Seed a fresh `ScrapeState`, set `params` so later node rewiring
 *      can read run params without depending on `target.cfg`.
 *   8. `dispatcher.execute(rootName, scrapeState)`.
 *   9. Write `failures.json` when any pages failed after retry.
 *
 * TODO (Wave 3): wire a `WorkerThreadContainer` parse pool when the compiled
 * `dist-workers/` tree is present, mirroring the pool pattern in `runHtml`.
 *
 * @param opts - Decoded DAG bundle, validated run params, and output/config dirs.
 * @returns Resolves after the bundle execution completes.
 *
 * @category Orchestrators
 * @since 2.7.0
 */
export async function runDag(opts: RunDagOptionsType): Promise<void> {
  const { dags, state, outDir, configDir } = opts;

  if (dags.length === 0) {
    throw new Error('runDag: dags bundle must contain at least one DAG');
  }

  // ── Build cache from state.cache ──────────────────────────────────────────
  const cache = (state.cache?.dir != null && state.cache.mode != null)
    ? ScraperCache.create({
        dir:   state.cache.dir,
        mode:  state.cache.mode,
        ttlMs: state.cache.ttlMs,
      })
    : null;

  // ── Build HTML scraper when baseUrl is present ────────────────────────────
  const htmlScraper = state.baseUrl != null
    ? HtmlScraper.create({
        baseUrl:     state.baseUrl,
        rateLimitMs: state.rateLimitMs,
        jitterMs:    state.jitterMs,
        headers:     state.headers as Record<string, string> | undefined,
        ...(cache !== null ? { cache } : {}),
      })
    : undefined;

  // ── Build MediaWiki scraper when apiUrl is present ────────────────────────
  const wikiScraper = state.apiUrl != null
    ? await MediaWikiScraper.create({
        apiUrl:      state.apiUrl,
        rateLimitMs: state.rateLimitMs,
        jitterMs:    state.jitterMs,
        ...(cache !== null ? { cache } : {}),
      })
    : undefined;

  // ── Ensure output directory exists ────────────────────────────────────────
  await mkdir(outDir, { recursive: true });

  // ── Services + dispatcher (proxy breaks construction circularity) ──────────
  // This pattern is identical to runHtml / runWiki: the Proxy holder lets the
  // dispatcher reference `services` before the services literal is built.
  const holder: { current: RipperServices | null } = { current: null };
  const dispatcher = new RipperDagonizer<ScrapeState>({
    services: new Proxy({} as RipperServices, {
      get(_target, prop) {
        if (holder.current === null) {
          throw new Error('RipperServices accessed before initialisation');
        }
        return (holder.current as unknown as Record<string | symbol, unknown>)[prop as string];
      },
    }),
  });

  // ── Determine root and registration order ─────────────────────────────────
  // Discover the root DAG (not referenced by any other in the bundle) and
  // produce a topological order (leaves first, root last) for registration.
  // dagonizer validates cross-DAG references at registerDAG time, so each
  // referenced DAG must already be in the dispatcher's dags map before the
  // referencing DAG is registered.
  const rootName   = bundleRootName(dags);
  const orderedDags = topoSort(dags, rootName);

  // ── Derive pluginTaskName from all DAGs' placements ───────────────────────
  // Walk every DAG in the bundle for the first non-builtin node name.
  // Populates `services.pluginTaskName` for compatibility with existing nodes.
  const pluginTaskName = derivePluginTaskNameFromBundle(dags);

  // Use the root DAG's name as the service target id (consistent with single-DAG
  // behaviour where the one DAG's name was used).
  const rootDag = orderedDags[orderedDags.length - 1] as DAGType;

  const splitByTaskName: boolean | undefined =
    typeof state.output.splitByTaskName === 'boolean'
      ? state.output.splitByTaskName
      : undefined;

  const services: RipperServices = {
    log:            Logger.forComponent('runDag'),
    cache,
    ...(htmlScraper !== undefined ? { htmlScraper } : {}),
    ...(wikiScraper !== undefined ? { wikiScraper } : {}),
    // `target` keeps the legacy shape expected by existing nodes.
    // `id` is the root DAG name; `cfg` is the raw state params object so
    // nodes that read `cfg['baseUrl']` etc. keep working during the sprout.
    target:         { id: rootDag.name, cfg: state as unknown as Record<string, unknown> },
    outDir,
    pluginTaskName,
    splitByTaskName,
    // Typed config fields — nodes read these instead of target.cfg[key].
    ...(state.crawler !== undefined           ? { crawler:            state.crawler }                     : {}),
    ...(state.headers !== undefined           ? { headers:            state.headers as Record<string, string> } : {}),
    ...(state.includeRawContent !== undefined ? { includeRawContent:  state.includeRawContent }           : {}),
    ...(state.outputSchema !== undefined      ? { outputSchema:       state.outputSchema }                : {}),
    ...(state.onSchemaError !== undefined     ? { onSchemaError:      state.onSchemaError }               : {}),
    dispatcher:     dispatcher as unknown as DagonizerInterface<ScrapeState, RipperServices>,
  };
  holder.current = services;

  // ── Node + plugin DAG registration ────────────────────────────────────────
  // Order: builtins first, then plugin DAGs + nodes discovered from the root
  // DAG's placements (new native DAG-document contract), then the orchestration
  // bundle's own DAGs in topo order (leaves first, root last).
  // `registerPluginsFromEntry` loads each plugin namespace's *.dag.jsonld files
  // and calls `plugins/<ns>/index.js` register — the orchestration's own DAGs
  // come after so they can reference the plugin DAGs already in the dispatcher.
  // Build the set of DAG names that are in-bundle so that registerPluginsFromEntry
  // skips them during namespace resolution (they are handled by the bundle topo-sort).
  const bundleDagNames = new Set(dags.map((dag) => dag.name));

  PluginLoader.registerBuiltinNodes(dispatcher);
  await PluginLoader.registerPluginsFromEntry(dispatcher, rootDag, configDir, bundleDagNames);

  // ── DAG registration (topological order: leaves first, root last) ─────────
  // Skip any DAG already registered by registerPluginsFromEntry to avoid
  // duplicate registration errors from dagonizer.
  const registeredNames = new Set(dispatcher.listDAGs().map((dag) => dag.name));
  for (const dag of orderedDags) {
    if (!registeredNames.has(dag.name)) {
      dispatcher.registerDAG(dag);
    }
  }

  // ── Seed initial state ────────────────────────────────────────────────────
  const scrapeState = new ScrapeState();
  scrapeState.params = state;

  // ── Dispatch the root ──────────────────────────────────────────────────────
  log.info('runDag', `Dispatching root DAG '${rootName}' (bundle size: ${dags.length.toString()})`);
  await dispatcher.execute(rootName, scrapeState);

  log.info('runDag',
    `Completed ${scrapeState.succeeded.length.toString()} pages on first attempt; `
    + `recovered ${scrapeState.recovered.length.toString()} on retry; `
    + `${scrapeState.failedAfterRetry.length.toString()} failed after retry`);

  // ── Failures manifest ──────────────────────────────────────────────────────
  if (scrapeState.failedAfterRetry.length > 0) {
    const manifest: FailuresManifestType = {
      timestamp: new Date().toISOString(),
      count:     scrapeState.failedAfterRetry.length,
      titles:    scrapeState.failedAfterRetry,
    };
    await writeFile(
      resolve(outDir, 'failures.json'),
      JSON.stringify(manifest, null, 2),
    );
    log.warn('runDag', `${scrapeState.failedAfterRetry.length.toString()} pages failed after retry — written to failures.json`);
  }
}

// ── Bundle helpers ─────────────────────────────────────────────────────────────

/**
 * Collect every DAG name referenced from within a bundle via
 * `EmbeddedDAGNode.dag` or `ScatterNode.body.dag` placements.
 *
 * Returns a `Set<string>` of child DAG names referenced by any DAG in the
 * bundle. Used by `bundleRootName` to identify the root (unreferenced) DAG.
 */
function referencedDagNames(dags: ReadonlyArray<DAGType>): Set<string> {
  const referenced = new Set<string>();
  for (const dag of dags) {
    for (const placement of dag.nodes) {
      if (placement['@type'] === 'EmbeddedDAGNode') {
        referenced.add(placement.dag);
      } else if (placement['@type'] === 'ScatterNode') {
        const body = placement.body;
        if ('dag' in body) {
          referenced.add(body.dag);
        }
      }
    }
  }
  return referenced;
}

/**
 * Discover the root DAG in a bundle: the DAG whose name is not referenced by
 * any other DAG in the bundle via an `EmbeddedDAGNode` or `ScatterNode.body.dag`.
 *
 * Throws a descriptive `Error` when zero or more than one root candidates exist
 * (ambiguous or cyclically-referencing bundles are not supported).
 *
 * @param dags - The full bundle of DAG documents.
 * @returns The name of the unique root DAG.
 */
function bundleRootName(dags: ReadonlyArray<DAGType>): string {
  const referenced = referencedDagNames(dags);
  const roots = dags.filter((dag) => !referenced.has(dag.name));

  if (roots.length === 1) {
    return (roots[0] as DAGType).name;
  }

  const names = dags.map((dag) => dag.name).join(', ');
  if (roots.length === 0) {
    throw new Error(
      `DAG bundle has no root: every DAG is referenced by another, suggesting a cycle. `
      + `Bundle DAGs: [${names}]`,
    );
  }
  const rootNames = roots.map((dag) => dag.name).join(', ');
  throw new Error(
    `DAG bundle has ${roots.length.toString()} root candidates — exactly one is required. `
    + `Roots: [${rootNames}]. Bundle DAGs: [${names}]`,
  );
}

/**
 * Topologically sort a DAG bundle: leaves first, root last.
 *
 * This satisfies dagonizer's `registerDAG` requirement that any DAG referenced
 * via `EmbeddedDAGNode.dag` or `ScatterNode.body.dag` must already be registered
 * before the referencing DAG is registered.
 *
 * Uses iterative Kahn's algorithm (in-degree sort) on the reference graph formed
 * by the bundle. Only intra-bundle references are considered — references to DAGs
 * outside the bundle are left for dagonizer to validate at registration time.
 *
 * @param dags     - All DAGs in the bundle (any order).
 * @param rootName - The pre-computed root DAG name (result of `bundleRootName`).
 * @returns A new array containing the same DAGs in leaves-first, root-last order.
 */
function topoSort(dags: ReadonlyArray<DAGType>, rootName: string): DAGType[] {
  if (dags.length === 1) return [dags[0] as DAGType];

  // Build adjacency: for each DAG, which bundle DAGs does it reference?
  const byName = new Map<string, DAGType>(dags.map((dag) => [dag.name, dag]));

  // in-degree: how many other bundle DAGs reference this DAG.
  const inDegree = new Map<string, number>(dags.map((dag) => [dag.name, 0]));
  // edges: dag name → set of bundle DAG names it references (children).
  const edges = new Map<string, Set<string>>(dags.map((dag) => [dag.name, new Set<string>()]));

  for (const dag of dags) {
    for (const placement of dag.nodes) {
      let childName: string | undefined;
      if (placement['@type'] === 'EmbeddedDAGNode') {
        childName = placement.dag;
      } else if (placement['@type'] === 'ScatterNode') {
        const body = placement.body;
        if ('dag' in body) {
          childName = body.dag;
        }
      }
      if (childName !== undefined && byName.has(childName)) {
        edges.get(dag.name)?.add(childName);
        inDegree.set(childName, (inDegree.get(childName) ?? 0) + 1);
      }
    }
  }

  // Kahn's: start from nodes with in-degree 0 (leaves — not referenced by others).
  const queue: string[] = [];
  for (const [name, deg] of inDegree) {
    if (deg === 0) queue.push(name);
  }

  const result: DAGType[] = [];
  while (queue.length > 0) {
    const name = queue.shift() as string;
    const dag  = byName.get(name);
    if (dag !== undefined) result.push(dag);

    for (const child of edges.get(name) ?? []) {
      const newDeg = (inDegree.get(child) ?? 1) - 1;
      inDegree.set(child, newDeg);
      if (newDeg === 0) queue.push(child);
    }
  }

  if (result.length !== dags.length) {
    const sorted    = new Set(result.map((dag) => dag.name));
    const remaining = dags.filter((dag) => !sorted.has(dag.name)).map((dag) => dag.name);
    throw new Error(
      `DAG bundle contains a cycle — cannot determine registration order. `
      + `Affected DAGs: [${remaining.join(', ')}]`,
    );
  }

  // Kahn's naturally places leaves first; the root (in-degree 0 after all
  // children are removed) ends up last. Verify the contract.
  // (If the root ended up not-last due to multiple in-degree-0 nodes in the
  // first pass, re-sort so rootName is last — its children always precede it.)
  const rootIdx = result.findIndex((dag) => dag.name === rootName);
  if (rootIdx !== result.length - 1) {
    result.splice(rootIdx, 1);
    result.push(byName.get(rootName) as DAGType);
  }

  return result;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Walk every DAG in the bundle and return the first non-builtin node name found.
 *
 * Inspects across all DAGs in the bundle:
 *   - `SingleNode.node`        — the backing node implementation name
 *   - `PhaseNode.node`         — the backing node implementation name
 *   - `ScatterNode.body.node`  — the scatter body node implementation name
 *
 * Skips names that start with any of `PluginLoader.BUILTIN_PREFIXES` or that
 * match the fixed-name built-in implementations.
 *
 * Returns `undefined` when every placement in every DAG resolves to a built-in.
 */
function derivePluginTaskNameFromBundle(dags: ReadonlyArray<DAGType>): string | undefined {
  for (const dag of dags) {
    for (const placement of dag.nodes) {
      let nodeName: string | undefined;
      if (placement['@type'] === 'SingleNode') {
        nodeName = placement.node;
      } else if (placement['@type'] === 'PhaseNode') {
        nodeName = placement.node;
      } else if (placement['@type'] === 'ScatterNode') {
        const body = placement.body;
        if ('node' in body) {
          nodeName = body.node;
        }
      }
      if (nodeName !== undefined && !isBuiltinNodeName(nodeName)) {
        return nodeName;
      }
    }
  }
  return undefined;
}

/**
 * Returns `true` when `name` identifies a built-in node implementation.
 *
 * Built-in implementations have names that start with one of
 * `PluginLoader.BUILTIN_PREFIXES`, or are the fixed internal names exposed
 * by `PluginLoader.registerBuiltinNodes`.
 */
function isBuiltinNodeName(name: string): boolean {
  if (PluginLoader.BUILTIN_PREFIXES.some((prefix) => name.startsWith(prefix))) return true;
  // TerminalNode is a placement-only construct with no backing NodeInterface,
  // so its name never appears in SingleNode.node — this guard is a safety net.
  if (name === 'terminal') return true;
  return false;
}
