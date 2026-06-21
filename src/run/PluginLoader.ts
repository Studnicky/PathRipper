/**
 * PluginLoader — static utility class for plugin discovery and node registration.
 *
 * Centralises the plugin-loading logic that was previously duplicated in
 * `runHtml.ts` and `runWiki.ts`. Both run files delegate to this class for:
 *   - registering built-in nodes onto a dispatcher
 *   - dynamically importing and registering plugin task modules
 *
 * @module run/PluginLoader
 * @since 4.1.0
 */

import { readdirSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { resolve }      from 'node:path';

import { DAGDocument }                        from '@studnicky/dagonizer';
import type { DAGType, DispatcherBundleType } from '@studnicky/dagonizer';

import { RipperDagonizer }      from '../dispatcher/RipperDagonizer.js';
import type { ScrapeState }     from '../state/ScrapeState.js';
import type { RipperServices }  from '../services/RipperServices.js';

import {
  HtmlFetchNode,
  WikiFetchNode,
  HtmlWriteRawNode,
  WikiWriteRawNode,
  JsonWriteNode,
  JsonlAppendNode,
  ValidateSchemaNode,
  CrawlListTargetsNode,
  TerminalNode,
} from '../nodes/index.js';

// ── PluginLoader ───────────────────────────────────────────────────────────────

/**
 * Static plugin-loading utilities shared by `runHtml` and `runWiki`.
 *
 * Every method is static — this class is a namespace for related behaviour, not
 * an instantiable service. All plugin DAG loading, builtin-node registration,
 * and pipeline validation live here.
 *
 * @category Plugin Loading
 * @since 4.1.0
 */
export class PluginLoader {
  /**
   * Pipeline entry prefixes that identify built-in pipeline steps.
   * Entries whose prefix matches one of these are skipped during plugin
   * discovery — they are handled by built-in nodes already registered via
   * `PluginLoader.registerBuiltinNodes`.
   */
  static readonly BUILTIN_PREFIXES: ReadonlyArray<string> = [
    'html:', 'wiki:', 'json:', 'jsonl:', 'validate:', 'crawl:',
  ];

  /**
   * Register all built-in scrape nodes onto the given dispatcher.
   *
   * Called before plugin registration so that builtin nodes are always
   * available regardless of which plugin (if any) is loaded.
   *
   * @param dispatcher - The dispatcher to register built-in nodes onto.
   */
  static registerBuiltinNodes(dispatcher: RipperDagonizer<ScrapeState>): void {
    dispatcher.registerNode(HtmlFetchNode);
    dispatcher.registerNode(WikiFetchNode);
    dispatcher.registerNode(HtmlWriteRawNode);
    dispatcher.registerNode(WikiWriteRawNode);
    dispatcher.registerNode(JsonWriteNode);
    dispatcher.registerNode(JsonlAppendNode);
    dispatcher.registerNode(ValidateSchemaNode);
    dispatcher.registerNode(CrawlListTargetsNode);
    dispatcher.registerNode(TerminalNode);
  }

  /**
   * Validate and return the pipeline array from an arbitrary target config.
   *
   * Throws with a clear message if `pipeline` is absent, empty, or contains
   * non-string entries.
   *
   * @param target   - The raw target config object.
   * @param targetId - The target identifier used in error messages.
   * @returns The validated pipeline as a `string[]`.
   */
  static requirePipeline(target: Record<string, unknown>, targetId: string): string[] {
    const pipeline = target['pipeline'];
    if (!Array.isArray(pipeline) || pipeline.length === 0) {
      throw new Error(`Target "${targetId}" must declare a non-empty pipeline: string[]`);
    }
    for (const name of pipeline) {
      if (typeof name !== 'string' || name.length === 0) {
        throw new Error(`Target "${targetId}" pipeline contains a non-string entry`);
      }
    }
    return pipeline as string[];
  }

  /**
   * Derive the plugin task name from a pipeline array.
   *
   * Returns the first pipeline entry that does not start with one of the
   * `BUILTIN_PREFIXES`. Returns `undefined` if every entry is a built-in.
   *
   * @param pipeline - Ordered list of pipeline step names.
   * @returns The first non-builtin pipeline entry, or `undefined`.
   */
  static derivePluginTaskName(pipeline: ReadonlyArray<string>): string | undefined {
    for (const entry of pipeline) {
      if (PluginLoader.BUILTIN_PREFIXES.some((prefix) => entry.startsWith(prefix))) continue;
      return entry;
    }
    return undefined;
  }

  /**
   * Dynamically import and register plugin task modules onto a dispatcher.
   *
   * Iterates `pipelineNames`, skips built-in prefixes, resolves each plugin as
   * `./plugins/{word}/{verb}.task.js` under `configDir`, dynamic-imports it
   * (tsx resolves `.js` → `.ts` in dev/test), and calls `mod.register(dispatcher)`.
   *
   * Deduplicates by resolved path so a plugin that appears multiple times in
   * the pipeline (e.g. `aonprd:parse` and a second `aonprd:load`) loads the
   * module only once but both entries are added to the returned Set.
   *
   * @param dispatcher    - The dispatcher to register plugin nodes and DAGs onto.
   * @param pipelineNames - Ordered list of pipeline step names from the target config.
   * @param configDir     - Absolute path to the directory that contains `plugins/`.
   * @returns A `Set<string>` of the pipeline entry names for which a plugin was loaded.
   */
  static async registerInto(
    dispatcher:    RipperDagonizer<ScrapeState>,
    pipelineNames: ReadonlyArray<string>,
    configDir:     string,
  ): Promise<Set<string>> {
    const pluginDagNames = new Set<string>();
    const seen = new Set<string>();

    for (const entry of pipelineNames) {
      if (PluginLoader.BUILTIN_PREFIXES.some((prefix) => entry.startsWith(prefix))) continue;
      const colon = entry.indexOf(':');
      if (colon <= 0) continue;
      const word = entry.slice(0, colon);
      const verb = entry.slice(colon + 1);
      const path = `./plugins/${word}/${verb}.task.js`;
      if (seen.has(path)) continue;
      seen.add(path);
      const absPath = resolve(configDir, path);
      let mod: unknown;
      try {
        mod = await import(absPath);
      } catch (err) {
        const nodeErr = err as NodeJS.ErrnoException;
        if (
          nodeErr.code === 'ENOENT' ||
          nodeErr.code === 'MODULE_NOT_FOUND' ||
          nodeErr.code === 'ERR_MODULE_NOT_FOUND'
        ) {
          throw new Error(`Plugin file not found: ${absPath}`, { cause: err });
        }
        throw err;
      }
      const modRecord = mod as Record<string, unknown>;
      if (typeof modRecord['register'] !== 'function') {
        throw new Error(
          `Plugin at ${absPath} does not export register(dispatcher): void. `
          + `Add: export function register(dispatcher: RipperDagonizer<ScrapeState>): void { ... }`,
        );
      }
      (modRecord['register'] as (d: RipperDagonizer<ScrapeState>) => void)(dispatcher);
      pluginDagNames.add(entry);
    }
    return pluginDagNames;
  }

  /**
   * Build a self-contained `DispatcherBundleType` for a pipeline by loading its
   * plugins onto a throwaway dispatcher and extracting the registered node + DAG
   * set.
   *
   * Used by the worker-thread parse registry (`src/workers/parseRegistry.ts`):
   * each worker rebuilds the same `{ nodes, dags }` the coordinator registered,
   * driven entirely by `pipelineNames` + `configDir` — no plugin is imported by
   * name. Builtin nodes are registered first so any builtin a plugin DAG
   * references resolves; the plugin's `register` then adds its own nodes + DAGs.
   *
   * The throwaway dispatcher is constructed with a null-holder Proxy services
   * bag: registration never accesses services (nodes read services only at
   * execution time, which happens in the host dispatcher, not here), so the
   * Proxy's get-trap never fires.
   *
   * @param pipelineNames - Ordered list of pipeline step names from the target config.
   * @param configDir     - Absolute path to the directory that contains `plugins/`.
   * @returns The extracted bundle plus the set of plugin DAG names that loaded.
   */
  /**
   * Discover plugin node modules referenced by a DAG bundle's placements and
   * register them onto `dispatcher`.
   *
   * Walks every placement in every DAG in the bundle and collects the node
   * implementation names from:
   *   - `SingleNode.node`        — the backing implementation
   *   - `PhaseNode.node`         — the backing implementation
   *   - `ScatterNode.body.node`  — the scatter body implementation
   *   - `EmbeddedDAGNode.dag`    — sub-DAG names (collected for reference but
   *     the sub-DAG is registered separately by `runDag`)
   *
   * For each non-builtin name of the form `<word>:<verb>`, resolves the plugin
   * as `./plugins/<word>/<verb>.task.js` under `configDir` and delegates to
   * `PluginLoader.registerInto`'s import + register logic via an inline pipeline
   * array so existing deduplication and error handling are reused exactly.
   *
   * Built-in names (those starting with `BUILTIN_PREFIXES`, plus `'terminal'`)
   * are skipped — `registerBuiltinNodes` already handles them.
   *
   * @param dispatcher - The dispatcher to register plugin nodes and DAGs onto.
   * @param dags       - The loaded DAG bundle whose placements drive discovery.
   * @param configDir  - Absolute path to the directory that contains `plugins/`.
   * @returns A `Set<string>` of the non-builtin node names for which a plugin loaded.
   */
  static async registerFromDags(
    dispatcher: RipperDagonizer<ScrapeState>,
    dags:       ReadonlyArray<DAGType>,
    configDir:  string,
  ): Promise<Set<string>> {
    // Collect candidate node names from all placement types across all DAGs.
    const candidates: string[] = [];
    for (const dag of dags) {
      for (const placement of dag.nodes) {
        if (placement['@type'] === 'SingleNode') {
          candidates.push(placement.node);
        } else if (placement['@type'] === 'PhaseNode') {
          candidates.push(placement.node);
        } else if (placement['@type'] === 'ScatterNode') {
          const body = placement.body;
          if ('node' in body) {
            candidates.push(body.node);
          }
          // dag-body scatter: the body DAG must already be registered; no module to import here.
        }
        // TerminalNode, EmbeddedDAGNode: no backing node module to load.
      }
    }

    // Filter to the subset that looks like plugin entries (`word:verb`)
    // and is not a built-in. Feed as a synthetic pipeline to `registerInto`
    // which handles deduplication, import errors, and `register()` invocation.
    const pluginCandidates = candidates.filter(
      (name) => !PluginLoader.BUILTIN_PREFIXES.some((prefix) => name.startsWith(prefix))
                && name !== 'terminal'
                && name.includes(':'),
    );

    return PluginLoader.registerInto(dispatcher, pluginCandidates, configDir);
  }

  /**
   * Native DAG-document contract: discover plugin namespaces from the entry DAG's
   * placements, load each plugin's `*.dag.jsonld` documents and register them,
   * then import the plugin's `index.js` registration entry and call `register`.
   *
   * For each `EmbeddedDAGNode.dag` or `ScatterNode.body.dag` value in the entry
   * DAG that does NOT start with a builtin prefix, extract the namespace (the
   * portion before `:`), resolve `plugins/<namespace>/` under `configDir`, load
   * every `*.dag.jsonld` file found there via `DAGDocument.load` + `registerDAG`,
   * then dynamic-import `plugins/<namespace>/index.js` and call its `register`.
   *
   * Registration order within each namespace: DAG documents first, then nodes
   * (so DAG-referencing nodes see the DAGs already registered).
   *
   * @param dispatcher - The dispatcher to register plugin DAGs and nodes onto.
   * @param entryDag   - The orchestration DAG whose placements drive namespace discovery.
   * @param configDir  - Absolute path to the directory that contains `plugins/`.
   * @returns A `Set<string>` of the plugin namespaces that were loaded.
   */
  /**
   * Sort a set of plugin DAGs in registration order: leaves first, dependents last.
   *
   * Performs a simple iterative pass: DAGs whose referenced DAGs are all already
   * in the registered set are placed next. Repeats until all DAGs are placed or
   * a pass produces no progress (cycle or unresolvable reference, left for
   * dagonizer to report at `registerDAG` time).
   *
   * Only intra-set references are considered — cross-set or cross-namespace
   * references are ignored here and validated by dagonizer.
   *
   * @param dags - The plugin DAGs to sort (any order).
   * @returns A new array in leaves-first, dependents-last order.
   */
  private static pluginDagsInRegistrationOrder(dags: ReadonlyArray<DAGType>): DAGType[] {
    const nameSet = new Set(dags.map((dag) => dag.name));
    const registered = new Set<string>();
    const result: DAGType[] = [];
    const remaining = [...dags];

    while (remaining.length > 0) {
      const beforeLen = result.length;
      for (let idx = remaining.length - 1; idx >= 0; idx--) {
        const dag = remaining[idx] as DAGType;
        const deps = dag.nodes
          .map((placement) => {
            if (placement['@type'] === 'EmbeddedDAGNode') return placement.dag;
            if (placement['@type'] === 'ScatterNode') {
              const body = placement.body;
              if ('dag' in body) return body.dag;
            }
            return undefined;
          })
          .filter((ref): ref is string => ref !== undefined && nameSet.has(ref));

        if (deps.every((dep) => registered.has(dep))) {
          result.push(dag);
          registered.add(dag.name);
          remaining.splice(idx, 1);
        }
      }
      // No progress this pass — break to avoid infinite loop; dagonizer will
      // report the unresolvable reference at registerDAG time.
      if (result.length === beforeLen) break;
    }

    // Any remaining (cycle / external dep) pushed last; dagonizer reports errors.
    for (const dag of remaining) result.push(dag);
    return result;
  }

  static async registerPluginsFromEntry(
    dispatcher:    RipperDagonizer<ScrapeState>,
    entryDag:      DAGType,
    configDir:     string,
    bundleDagNames?: ReadonlySet<string>,
  ): Promise<Set<string>> {
    // Collect non-builtin dag-reference names from EmbeddedDAGNode and ScatterNode placements.
    // Skip references that are satisfied within the bundle itself (those are handled
    // by the bundle topological sort and don't need plugin-namespace resolution).
    const dagRefs = new Set<string>();
    for (const placement of entryDag.nodes) {
      let dagRef: string | undefined;
      if (placement['@type'] === 'EmbeddedDAGNode') {
        dagRef = placement.dag;
      } else if (placement['@type'] === 'ScatterNode') {
        const body = placement.body;
        if ('dag' in body) {
          dagRef = body.dag;
        }
      }
      if (
        dagRef !== undefined &&
        !PluginLoader.BUILTIN_PREFIXES.some((prefix) => dagRef!.startsWith(prefix)) &&
        !(bundleDagNames?.has(dagRef) === true)
      ) {
        dagRefs.add(dagRef);
      }
    }

    // Derive distinct plugin namespaces (the segment before `:`).
    const namespaces = new Set<string>();
    for (const ref of dagRefs) {
      const colon = ref.indexOf(':');
      if (colon > 0) {
        namespaces.add(ref.slice(0, colon));
      }
    }

    const loaded = new Set<string>();
    for (const namespace of namespaces) {
      const pluginDir = resolve(configDir, `plugins/${namespace}`);

      // Load every *.dag.jsonld file in the plugin directory.
      let files: string[];
      try {
        files = readdirSync(pluginDir).filter((file) => file.endsWith('.dag.jsonld'));
      } catch {
        throw new Error(
          `Plugin directory not found for namespace '${namespace}': ${pluginDir}`,
        );
      }

      // Import and call the plugin's registration entry FIRST so that node
      // implementations are in the dispatcher before DAG validation runs.
      // dagonizer validates node references at registerDAG time, so nodes must
      // precede their DAGs.
      const entryPath = resolve(pluginDir, 'index.js');
      let mod: unknown;
      try {
        mod = await import(entryPath);
      } catch (err) {
        const nodeErr = err as NodeJS.ErrnoException;
        if (
          nodeErr.code === 'ENOENT' ||
          nodeErr.code === 'MODULE_NOT_FOUND' ||
          nodeErr.code === 'ERR_MODULE_NOT_FOUND'
        ) {
          throw new Error(`Plugin entry not found: ${entryPath}`, { cause: err });
        }
        throw err;
      }
      const modRecord = mod as Record<string, unknown>;
      if (typeof modRecord['register'] !== 'function') {
        throw new Error(
          `Plugin at ${entryPath} does not export register(dispatcher): void. `
          + `Add: export function register(dispatcher: RipperDagonizer<ScrapeState>): void { ... }`,
        );
      }
      (modRecord['register'] as (dispatcher: RipperDagonizer<ScrapeState>) => void)(dispatcher);

      // Load all plugin DAGs, then register in dependency order (leaves first).
      // Nodes are already registered above so DAG validation succeeds.
      const pluginDags = files.map((file) => {
        const dagJson = readFileSync(resolve(pluginDir, file), 'utf-8');
        return DAGDocument.load(dagJson);
      });
      for (const dag of PluginLoader.pluginDagsInRegistrationOrder(pluginDags)) {
        dispatcher.registerDAG(dag);
      }

      loaded.add(namespace);
    }

    return loaded;
  }

  static async bundle(
    pipelineNames: ReadonlyArray<string>,
    configDir:     string,
  ): Promise<{ bundle: DispatcherBundleType<ScrapeState, RipperServices>; pluginDagNames: Set<string> }> {
    const holder: { current: RipperServices | null } = { current: null };
    const throwaway = new RipperDagonizer<ScrapeState>({
      services: new Proxy({} as RipperServices, {
        get(_target, prop) {
          if (holder.current === null) {
            throw new Error('RipperServices accessed before initialisation');
          }
          return (holder.current as unknown as Record<string | symbol, unknown>)[prop as string];
        },
      }),
    });

    PluginLoader.registerBuiltinNodes(throwaway);
    const pluginDagNames = await PluginLoader.registerInto(throwaway, pipelineNames, configDir);

    return {
      bundle: {
        nodes: [...throwaway.listNodes()],
        dags:  [...throwaway.listDAGs()],
      },
      pluginDagNames,
    };
  }
}
