/**
 * htmlPageFlow — per-URL child DAG for one HTML page scrape.
 *
 * Built directly with `DAGBuilder`: walks the pipeline node names in order,
 * resolving each to its real registered node instance, wires routes
 * (success/cached/skipped → next step, error ports → terminal), and appends
 * the `htmlPage:completed` / `htmlPage:failed` terminals.
 *
 * Plugin DAG steps (names present in `pluginDagNames`) are placed via
 * `.embeddedDAG()` — no node instance required.
 *
 * `crawl:list-targets` is filtered out (outer-DAG concern, not per-page).
 *
 * Chain: html:fetch → [parse steps] → [write/validate steps] → htmlPage:completed
 */

import { DAGBuilder } from '@studnicky/dagonizer';
import type { DAGType, NodeInterface } from '@studnicky/dagonizer';

import type { ScrapeState }   from '../state/ScrapeState.js';
import type { RipperServices } from '../services/RipperServices.js';

import {
  HtmlFetchNode,
  HtmlWriteRawNode,
  JsonWriteNode,
  JsonlAppendNode,
  ValidateSchemaNode,
} from '../nodes/index.js';

// ── Terminal names ─────────────────────────────────────────────────────────────

const COMPLETED = 'htmlPage:completed';
const FAILED    = 'htmlPage:failed';

// ── Types ──────────────────────────────────────────────────────────────────────

type HtmlNode = NodeInterface<ScrapeState, string, RipperServices>;

// ── Builtin name → node instance registry ─────────────────────────────────────

const BUILTIN_NODES: ReadonlyMap<string, HtmlNode> = new Map<string, HtmlNode>([
  [HtmlFetchNode.name,      HtmlFetchNode],
  [HtmlWriteRawNode.name,   HtmlWriteRawNode],
  [JsonWriteNode.name,      JsonWriteNode],
  [JsonlAppendNode.name,    JsonlAppendNode],
  [ValidateSchemaNode.name, ValidateSchemaNode],
]);

/**
 * Deterministic DAG name for a target's per-URL child flow.
 * Used as the scatter body `{ dag }` reference in the HTML phase DAGs.
 *
 * @category Flows
 * @since 4.0.0
 */
export const htmlPageFlowName = (targetId: string): string => `htmlPageDAG:${targetId}`;

/**
 * Builds a per-URL child DAG from the user's `pipeline: string[]` config.
 *
 * Each registered node's full output set is wired; routing is:
 *   - `html:fetch`     → `success`/`cached` continue; `error` terminates (failed).
 *   - `html:write-raw` → `success` continues.
 *   - `json:write`     → `success`/`skipped` continue.
 *   - `jsonl:append`   → `success`/`skipped` continue.
 *   - `validate:schema`→ `valid` continues; `invalid` terminates (failed).
 *   - Plugin DAG steps → `.embeddedDAG()` (`success` continues; `error` terminates failed).
 *
 * @param pipelineNames  - Ordered list of node names from the target config.
 *   `crawl:list-targets` is silently filtered.
 * @param targetId       - Used to build the deterministic DAG name.
 * @param pluginDagNames - Names of pipeline entries that are registered as DAGs
 *                         (not nodes). These get `.embeddedDAG()` placements.
 *                         Defaults to empty set.
 * @returns A `DAGType` ready for `dispatcher.registerDAG()`.
 *
 * @category Flows
 * @since 4.0.0
 */
export const buildHtmlPageFlow = (
  pipelineNames:  ReadonlyArray<string>,
  targetId:       string,
  pluginDagNames: ReadonlySet<string> = new Set(),
): DAGType => {
  const steps = pipelineNames.filter((name) => name !== 'crawl:list-targets');

  if (steps.length === 0) {
    throw new Error(`Target "${targetId}" pipeline has no steps after filtering crawl:list-targets`);
  }

  const dagName = htmlPageFlowName(targetId);
  const builder = new DAGBuilder(dagName, '2.0');

  for (let index = 0; index < steps.length; index++) {
    const name = steps[index] as string;
    const next = index + 1 < steps.length ? (steps[index + 1] as string) : COMPLETED;

    if (pluginDagNames.has(name)) {
      // Plugin DAG step: embedded sub-DAG, no node instance needed.
      // Seed the child with the fetched `page` (carries html/url the plugin reads)
      // and map child `output` back to parent `output` so json:write sees the parsed result.
      // Transient `aonprd*` metadata the plugin sets already crosses the clone boundary.
      builder.embeddedDAG<ScrapeState, ScrapeState>(name, name, { success: next, error: FAILED }, {
        inputs:  { page: 'page' },
        outputs: { output: 'output' },
      });
      continue;
    }

    const node = BUILTIN_NODES.get(name);

    if (node === undefined) {
      // Unknown step: treat as a plugin embedded DAG (success continues, error terminates).
      // This covers steps registered on the dispatcher outside of BUILTIN_NODES that are
      // not explicitly declared in pluginDagNames (e.g. plugin DAGs with defaulted callers).
      // Seed the child with `page` and map child `output` back to parent `output`.
      builder.embeddedDAG<ScrapeState, ScrapeState>(name, name, { success: next, error: FAILED }, {
        inputs:  { page: 'page' },
        outputs: { output: 'output' },
      });
      continue;
    }

    if (name === 'html:fetch') {
      builder.node(name, node, { success: next, cached: next, error: FAILED });
    } else if (name === 'html:write-raw') {
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
