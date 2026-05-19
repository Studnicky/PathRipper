/**
 * htmlPageFlow — per-URL child DAG for one HTML page scrape.
 *
 * Contract-derived via `FlowDeriver.derive` with `annotations.subDAGs` for
 * plugin DAG placements (adopted in 0.7.0). Each pipeline step maps to an
 * `OperationContract`; plugin steps additionally appear in `annotations.subDAGs`
 * so the deriver emits a `DeepDAGNode` placement instead of `SingleNode`.
 *
 * The dynamic-construction concern (pipeline comes from user config) is orthogonal
 * to FlowDeriver — we call `FlowDeriver.derive({...})` with the per-target
 * contracts list at construction time, same dynamism the previous DAGBuilder
 * version had, just declarative.
 *
 * The data-graph chain is:
 *   html:fetch → [parse steps] → [write/validate steps]
 *
 * `crawl:list-targets` is filtered out (outer-DAG concern, not per-page).
 *
 * Plugin DAG names are registered separately on the dispatcher via
 * `mod.register(dispatcher)`; the contract treats them as opaque step names.
 *
 * `flow:terminate` is a required terminal node appended to the pipeline so that
 * DeepDAGNode error exits can route to a real node rather than null (DeepDAG
 * placements cannot terminate the run directly).
 */

import { FlowDeriver } from '@noocodex/dagonizer/derive';
import type { OperationContract, FlowAnnotations, FlowDeepDAG, FlowTerminal } from '@noocodex/dagonizer/derive';
import type { DAG } from '@noocodex/dagonizer';

/**
 * Deterministic DAG name for a target's per-URL child flow.
 * Matches the old `htmlPageDagName` so dispatcher registrations and
 * `DispatchPageDagNode.childDagName` references remain unchanged.
 *
 * @category Flows
 * @since 4.0.0
 */
export const htmlPageFlowName = (targetId: string): string => `htmlPageDAG:${targetId}`;

// ── Output routing constants ───────────────────────────────────────────────────

/** Outputs that continue to the next pipeline step. */
const CONTINUE: Record<string, true> = {
  success: true,
  cached:  true,
  valid:   true,
  skipped: true,
};

/** Outputs from write/validate nodes that should continue to the next step. */
const WRITE_CONTINUE: Record<string, true> = {
  success: true,
  skipped: true,
};

/** All known non-continue outputs from pipeline nodes. */
const TERMINAL_OUTPUTS = ['error', 'invalid', 'empty', 'unknown'] as const;

// ── Per-step contract shapes ───────────────────────────────────────────────────

/**
 * Contract for a named step in the pipeline. Each step uses a unique
 * fictional produce key (`step_${i}`) so the data graph chains them linearly.
 */
const stepContract = (
  name:    string,
  i:       number,
  outputs: readonly string[],
): OperationContract => ({
  name,
  hardRequired: i === 0 ? [] : [`step_${(i - 1).toString()}`],
  produces:     [`step_${i.toString()}`],
  outputs:      [...outputs],
});

/**
 * Builds a per-URL child DAG from the user's `pipeline: string[]` config.
 *
 * Each registered node's full output set is declared in the contract; routing is:
 *   - `html:fetch`    → `success`/`cached` continue; `error` terminates to null.
 *   - `html:write-raw`→ `success` continues.
 *   - `json:write`    → `success`/`skipped` continue.
 *   - `jsonl:append`  → `success`/`skipped` continue.
 *   - `validate:schema`→ `valid` continues; `invalid` terminates to null.
 *   - Plugin DAG steps → `DeepDAGNode` placement via `annotations.subDAGs`
 *                         (`success` continues; `error` routes to `flow:terminate`).
 *   - Plugin node steps → `success` continues; `error` terminates to null.
 *
 * @param pipelineNames  - Ordered list of node names from the target config.
 *   `crawl:list-targets` is silently filtered; `flow:terminate` is appended if absent.
 * @param targetId       - Used to build the deterministic DAG name.
 * @param pluginDagNames - Names of pipeline entries that are registered as DAGs
 *                         (not nodes). These get `DeepDAGNode` placements via
 *                         `annotations.subDAGs`. Defaults to empty set.
 * @returns A `DAG` ready for `dispatcher.registerDAG()`.
 *
 * @category Flows
 * @since 4.0.0
 */
export const buildHtmlPageFlow = (
  pipelineNames:  ReadonlyArray<string>,
  targetId:       string,
  pluginDagNames: ReadonlySet<string> = new Set(),
): DAG => {
  const steps = pipelineNames.filter((n) => n !== 'crawl:list-targets');

  if (steps.length === 0) {
    throw new Error(`Target "${targetId}" pipeline has no steps after filtering crawl:list-targets`);
  }

  // Append flow:terminate if not already present — DeepDAGNode error exits route here.
  const allSteps = steps.includes('flow:terminate') ? steps : [...steps, 'flow:terminate'];

  const dagName    = htmlPageFlowName(targetId);
  const contracts: OperationContract[] = [];
  const subDAGs:   Record<string, FlowDeepDAG> = {};
  const terminals: Record<string, FlowTerminal[]> = {};

  for (let i = 0; i < allSteps.length; i++) {
    const name = allSteps[i] as string;

    if (name === 'flow:terminate') {
      // Terminal sentinel node: consumes previous step, produces nothing, exits.
      contracts.push({
        name,
        hardRequired: i === 0 ? [] : [`step_${(i - 1).toString()}`],
        produces:     [],
        outputs:      ['success'],
      });
      terminals['flow:terminate'] = [{ outcome: 'success', target: null }];
      continue;
    }

    if (name === 'html:fetch') {
      contracts.push(stepContract(name, i, ['success', 'cached', 'error']));
      terminals[name] = [{ outcome: 'error', target: null }];
    } else if (name === 'html:write-raw') {
      contracts.push(stepContract(name, i, ['success']));
    } else if (name === 'json:write') {
      contracts.push(stepContract(name, i, ['success', 'skipped']));
    } else if (name === 'jsonl:append') {
      contracts.push(stepContract(name, i, ['success', 'skipped']));
    } else if (name === 'validate:schema') {
      contracts.push(stepContract(name, i, ['valid', 'invalid']));
      // valid continues to next stage; invalid terminates.
      // FlowDeriver auto-wires 'valid' to the next derived stage since it's the
      // first non-overridden port. We override 'invalid' only.
      terminals[name] = [{ outcome: 'invalid', target: null }];
    } else if (pluginDagNames.has(name)) {
      // Plugin DAG step: DeepDAGNode placement via subDAGs annotation.
      // error routes to flow:terminate (DeepDAG placements cannot route to null).
      contracts.push(stepContract(name, i, ['success', 'error']));
      subDAGs[name] = {
        dag:     name,
        outputs: ['success', 'error'],
        stateMapping: { output: { output: 'output' } },
      };
      // Ensure flow:terminate is the target for errors.
      terminals[name] = [{ outcome: 'error', target: 'flow:terminate' }];
    } else {
      // Parse node steps: success continues, error terminates.
      contracts.push(stepContract(name, i, ['success', 'error']));
      terminals[name] = [{ outcome: 'error', target: null }];
    }
  }

  const annotations: FlowAnnotations = {
    ...(Object.keys(terminals).length > 0 ? { terminals } : {}),
    ...(Object.keys(subDAGs).length   > 0 ? { subDAGs }  : {}),
  };

  return FlowDeriver.derive({
    name:        dagName,
    version:     '2.0',
    entrypoint:  allSteps[0] as string,
    contracts,
    annotations,
  });
};

// Re-export for convenience (used in tests and docs visualizer).
export { CONTINUE, WRITE_CONTINUE, TERMINAL_OUTPUTS };
