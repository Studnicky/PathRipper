/**
 * runDag — execute a user-authored dagonizer DAG from `.dag.jsonld` + `.state.json`.
 *
 * A scrape run in the new native-DAG model consists of two files:
 *   - A `.dag.jsonld` containing a pure dagonizer topology (the whole run:
 *     crawl → scatter → fetch/parse/write → retry), loaded via `DAGDocument.load`.
 *   - A `.state.json` containing run params validated against `RunStateSchema`,
 *     used to build services (cache, scrapers, output dir, …).
 *
 * The entry point `runDagFromFiles` reads both files and delegates to the
 * testable `runDag` core. `PluginLoader.registerFromDag` discovers which plugin
 * node modules the DAG references and registers them automatically.
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
 * `dagPath` is parsed and validated by `DAGDocument.load`.
 * `statePath` is validated against `RunStateSchema`; throws with a clear message
 * on failure.
 *
 * @param opts - File paths and output/config directories.
 * @returns Resolves after the DAG completes and the failures manifest (if any)
 *   is written.
 *
 * @category Orchestrators
 * @since 2.7.0
 */
export async function runDagFromFiles(opts: RunDagFromFilesOptionsType): Promise<void> {
  const dagJson    = await readFile(opts.dagPath,   'utf-8');
  const stateJson  = await readFile(opts.statePath, 'utf-8');

  const dag        = DAGDocument.load(dagJson);
  const rawState   = JSON.parse(stateJson) as unknown;
  const stateError = RunStateSchema.validate(rawState);

  if (stateError !== null) {
    throw new Error(
      `Invalid run-state file at ${opts.statePath}:\n  ${stateError}`,
    );
  }

  await runDag({
    dag,
    state:     rawState as RunStateType,
    outDir:    opts.outDir,
    configDir: opts.configDir,
  });
}

// ── runDag ─────────────────────────────────────────────────────────────────────

/**
 * Execute a dagonizer DAG driven by validated run params.
 *
 * Construction order:
 *   1. Build `cache`, `htmlScraper`, `wikiScraper` from `state` params.
 *   2. `mkdir` the output directory.
 *   3. Construct `RipperDagonizer` with the proxy-services pattern.
 *   4. Build the `RipperServices` bag; wire `holder.current`.
 *   5. `PluginLoader.registerBuiltinNodes` + `PluginLoader.registerFromDag`
 *      (discovers plugin modules referenced by the DAG placements).
 *   6. `dispatcher.registerDAG(dag)`.
 *   7. Seed a fresh `ScrapeState`, set `params` so later node rewiring
 *      can read run params without depending on `target.cfg`.
 *   8. `dispatcher.execute(dag.name, scrapeState)`.
 *   9. Write `failures.json` when any pages failed after retry.
 *
 * TODO (Wave 3): wire a `WorkerThreadContainer` parse pool when the compiled
 * `dist-workers/` tree is present, mirroring the pool pattern in `runHtml`.
 *
 * @param opts - Decoded DAG, validated run params, and output/config dirs.
 * @returns Resolves after the DAG completes.
 *
 * @category Orchestrators
 * @since 2.7.0
 */
export async function runDag(opts: RunDagOptionsType): Promise<void> {
  const { dag, state, outDir, configDir } = opts;

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

  // ── Derive pluginTaskName from the DAG's first plugin-node placement ──────
  // Walk all placement `node` fields (SingleNode, PhaseNode) and the `body.node`
  // field (ScatterNode with node body) to find a non-builtin node name.
  // Populates `services.pluginTaskName` for compatibility with existing nodes.
  // Wave 3 will migrate nodes to read directly from `state.params`.
  const pluginTaskName = derivePluginTaskNameFromDag(dag);

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
    // `id` is the DAG name; `cfg` is the raw state params object so
    // nodes that read `cfg['baseUrl']` etc. keep working during the sprout.
    target:         { id: dag.name, cfg: state as unknown as Record<string, unknown> },
    outDir,
    pluginTaskName,
    splitByTaskName,
    dispatcher:     dispatcher as unknown as DagonizerInterface<ScrapeState, RipperServices>,
  };
  holder.current = services;

  // ── Node registration ──────────────────────────────────────────────────────
  PluginLoader.registerBuiltinNodes(dispatcher);
  await PluginLoader.registerFromDag(dispatcher, dag, configDir);

  // ── DAG registration ───────────────────────────────────────────────────────
  dispatcher.registerDAG(dag);

  // ── Seed initial state ────────────────────────────────────────────────────
  const scrapeState = new ScrapeState();
  scrapeState.params = state;

  // ── Dispatch ───────────────────────────────────────────────────────────────
  log.info('runDag', `Dispatching DAG '${dag.name}'`);
  await dispatcher.execute(dag.name, scrapeState);

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

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Walk the DAG placements and return the first non-builtin node name.
 *
 * Inspects:
 *   - `SingleNode.node` — the backing node implementation name
 *   - `PhaseNode.node`  — the backing node implementation name
 *   - `ScatterNode.body.node` — the scatter body node implementation name
 *
 * Skips names that start with any of `PluginLoader.BUILTIN_PREFIXES` or that
 * match the fixed-name built-in implementations.
 *
 * Returns `undefined` when every placement resolves to a built-in.
 */
function derivePluginTaskNameFromDag(dag: DAGType): string | undefined {
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
