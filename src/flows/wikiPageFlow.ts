/**
 * wikiPageFlow — per-title child DAG for one wiki page scrape.
 *
 * Built directly with `DAGBuilder`: walks the pipeline node names in order,
 * resolving each to its real registered node instance, wires routes
 * (success → next step, error ports → terminal), and appends the
 * `wikiPage:completed` / `wikiPage:failed` terminals.
 *
 * Plugin DAG steps (names present in `pluginDagNames`) are placed via
 * `.embeddedDAG()` — no node instance required.
 *
 * Chain: wiki:fetch → [parse steps] → [write steps] → wikiPage:completed
 */

import { DAGBuilder } from '@studnicky/dagonizer';
import type { DAGType, NodeInterface } from '@studnicky/dagonizer';

import type { ScrapeState }   from '../state/ScrapeState.js';
import type { RipperServices } from '../services/RipperServices.js';

import {
  WikiFetchNode,
  WikiWriteRawNode,
  JsonWriteNode,
  JsonlAppendNode,
  ValidateSchemaNode,
} from '../nodes/index.js';

// ── Terminal names ─────────────────────────────────────────────────────────────

const COMPLETED = 'wikiPage:completed';
const FAILED    = 'wikiPage:failed';

// ── Types ──────────────────────────────────────────────────────────────────────

type WikiNode = NodeInterface<ScrapeState, string, RipperServices>;

// ── Builtin name → node instance registry ─────────────────────────────────────

const BUILTIN_NODES: ReadonlyMap<string, WikiNode> = new Map<string, WikiNode>([
  [WikiFetchNode.name,       WikiFetchNode],
  [WikiWriteRawNode.name,    WikiWriteRawNode],
  [JsonWriteNode.name,       JsonWriteNode],
  [JsonlAppendNode.name,     JsonlAppendNode],
  [ValidateSchemaNode.name,  ValidateSchemaNode],
]);

/**
 * Deterministic DAG name for a target's per-title child flow.
 * Used as the scatter body `{ dag }` reference in the wiki phase DAGs.
 *
 * @category Flows
 * @since 4.0.0
 */
export const wikiPageFlowName = (targetId: string): string => `wikiPageDAG:${targetId}`;

/**
 * Builds a per-title child DAG from the user's `pipeline: string[]` config.
 *
 * Node routing:
 *   - `wiki:fetch`     → `success` continues; `error` terminates (failed).
 *   - `wiki:write-raw` → `success` continues.
 *   - `json:write`     → `success`/`skipped` continue.
 *   - `jsonl:append`   → `success`/`skipped` continue.
 *   - `validate:schema`→ `valid` continues; `invalid` terminates (failed).
 *   - Plugin DAG steps → `.embeddedDAG()` (`success` continues; `error` terminates failed).
 *
 * @param pipelineNames  - Ordered list of node names from the target config.
 * @param targetId       - Used to build the deterministic DAG name.
 * @param pluginDagNames - Names of pipeline entries that are registered as DAGs
 *                         (not nodes). These get `.embeddedDAG()` placements.
 *                         Defaults to empty set.
 * @returns A `DAGType` ready for `dispatcher.registerDAG()`.
 *
 * @category Flows
 * @since 4.0.0
 */
export const buildWikiPageFlow = (
  pipelineNames:  ReadonlyArray<string>,
  targetId:       string,
  pluginDagNames: ReadonlySet<string> = new Set(),
): DAGType => {
  if (pipelineNames.length === 0) {
    throw new Error(`Target "${targetId}" pipeline has no steps`);
  }

  const dagName = wikiPageFlowName(targetId);
  const builder = new DAGBuilder(dagName, '2.0');

  const steps = [...pipelineNames];

  for (let index = 0; index < steps.length; index++) {
    const name = steps[index] as string;
    const next = index + 1 < steps.length ? (steps[index + 1] as string) : COMPLETED;

    if (pluginDagNames.has(name)) {
      // Plugin DAG step: embedded sub-DAG, no node instance needed.
      builder.embeddedDAG(name, name, { success: next, error: FAILED });
      continue;
    }

    const node = BUILTIN_NODES.get(name);

    if (node === undefined) {
      // Unknown step: treat as a plugin embedded DAG (success continues, error terminates).
      // This covers steps registered on the dispatcher outside of BUILTIN_NODES that are
      // not explicitly declared in pluginDagNames (e.g. plugin DAGs with defaulted callers).
      builder.embeddedDAG(name, name, { success: next, error: FAILED });
      continue;
    }

    if (name === 'wiki:fetch') {
      builder.node(name, node, { success: next, error: FAILED });
    } else if (name === 'wiki:write-raw') {
      builder.node(name, node, { success: next });
    } else if (name === 'json:write') {
      builder.node(name, node, { success: next, skipped: next });
    } else if (name === 'jsonl:append') {
      builder.node(name, node, { success: next, skipped: next });
    } else if (name === 'validate:schema') {
      builder.node(name, node, { valid: next, invalid: FAILED });
    } else {
      // Known builtin not matched above: route success, terminate on error.
      const routes: Record<string, string> = {};
      for (const output of node.outputs) {
        routes[output] = output === 'error' || output === 'invalid' ? FAILED : next;
      }
      builder.node(name, node, routes);
    }
  }

  builder.terminal(COMPLETED, { outcome: 'completed' });
  builder.terminal(FAILED,    { outcome: 'failed' });

  return builder.build();
};
