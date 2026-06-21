/**
 * PluginLoader — static utility class for plugin discovery and node registration.
 *
 * Centralises the plugin-loading logic used by `runDag`.
 *
 * @module run/PluginLoader
 * @since 4.1.0
 */

import { readdirSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { resolve }      from 'node:path';

import { DAGDocument }            from '@studnicky/dagonizer';
import type { DAGType }           from '@studnicky/dagonizer';

import type { RipperDagonizer } from '../dispatcher/RipperDagonizer.js';
import type { ScrapeState }     from '../state/ScrapeState.js';

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
 * Static plugin-loading utilities shared by `runDag`.
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
   * @param bundleDagNames - Names of DAGs already in the bundle (skipped during namespace resolution).
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
}
