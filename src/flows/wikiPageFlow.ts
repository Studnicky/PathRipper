/**
 * wikiPageFlow — per-title child DAG for one wiki page scrape.
 *
 * Contract-derived via `DAGDeriver.derive` with `annotations.subDAGs` for
 * plugin DAG placements (adopted in 0.7.0). Each pipeline step maps to an
 * `OperationContract`; plugin steps additionally appear in `annotations.subDAGs`
 * so the deriver emits a `DeepDAGNode` placement instead of `SingleNode`.
 *
 * The dynamic-construction concern (pipeline comes from user config) is orthogonal
 * to DAGDeriver — we call `DAGDeriver.derive({...})` with the per-target
 * contracts list at construction time, same dynamism the previous DAGBuilder
 * version had, just declarative.
 *
 * Chain: wiki:fetch → [parse steps] → [write steps]
 *
 * `flow:terminate` is a required terminal node appended to the pipeline so that
 * DeepDAGNode error exits can route to a real node rather than null (DeepDAG
 * placements cannot terminate the run directly).
 */

import { DAGDeriver } from '@noocodex/dagonizer/derive';
import type { OperationContract, DAGDeriverAnnotations, DAGDeriverSubDAG, DAGDeriverTerminal } from '@noocodex/dagonizer/derive';
import type { DAG } from '@noocodex/dagonizer';

/**
 * Deterministic DAG name for a target's per-title child flow.
 * Matches the old `wikiPageDagName` so dispatcher registrations and
 * `DispatchPageDagNode.childDagName` references remain unchanged.
 *
 * @category Flows
 * @since 4.0.0
 */
export const wikiPageFlowName = (targetId: string): string => `wikiPageDAG:${targetId}`;

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
 * Builds a per-title child DAG from the user's `pipeline: string[]` config.
 *
 * Node routing:
 *   - `wiki:fetch`    → `success` continues; `error` terminates to null.
 *   - `wiki:write-raw`→ `success` continues.
 *   - `json:write`    → `success`/`skipped` continue.
 *   - `jsonl:append`  → `success`/`skipped` continue.
 *   - `validate:schema`→ `valid` continues; `invalid` terminates to null.
 *   - Plugin DAG steps → `DeepDAGNode` placement via `annotations.subDAGs`
 *                         (`success` continues; `error` routes to `flow:terminate`).
 *   - Plugin node steps → `success` continues; `error` terminates to null.
 *
 * @param pipelineNames  - Ordered list of node names from the target config.
 *   `flow:terminate` is appended if absent.
 * @param targetId       - Used to build the deterministic DAG name.
 * @param pluginDagNames - Names of pipeline entries that are registered as DAGs
 *                         (not nodes). These get `DeepDAGNode` placements via
 *                         `annotations.subDAGs`. Defaults to empty set.
 * @returns A `DAG` ready for `dispatcher.registerDAG()`.
 *
 * @category Flows
 * @since 4.0.0
 */
export const buildWikiPageFlow = (
  pipelineNames:  ReadonlyArray<string>,
  targetId:       string,
  pluginDagNames: ReadonlySet<string> = new Set(),
): DAG => {
  if (pipelineNames.length === 0) {
    throw new Error(`Target "${targetId}" pipeline has no steps`);
  }

  // Append flow:terminate if not already present — DeepDAGNode error exits route here.
  const allSteps = pipelineNames.includes('flow:terminate')
    ? [...pipelineNames]
    : [...pipelineNames, 'flow:terminate'];

  const dagName    = wikiPageFlowName(targetId);
  const contracts: OperationContract[] = [];
  const subDAGs:   Record<string, DAGDeriverSubDAG> = {};
  const terminals: Record<string, DAGDeriverTerminal[]> = {};

  for (let i = 0; i < allSteps.length; i++) {
    const name = allSteps[i] as string;

    if (name === 'flow:terminate') {
      contracts.push({
        name,
        hardRequired: i === 0 ? [] : [`step_${(i - 1).toString()}`],
        produces:     [],
        outputs:      ['success'],
      });
      terminals['flow:terminate'] = [{ outcome: 'success', target: null }];
      continue;
    }

    if (name === 'wiki:fetch') {
      contracts.push(stepContract(name, i, ['success', 'error']));
      terminals[name] = [{ outcome: 'error', target: null }];
    } else if (name === 'wiki:write-raw') {
      contracts.push(stepContract(name, i, ['success']));
    } else if (name === 'json:write') {
      contracts.push(stepContract(name, i, ['success', 'skipped']));
    } else if (name === 'jsonl:append') {
      contracts.push(stepContract(name, i, ['success', 'skipped']));
    } else if (name === 'validate:schema') {
      contracts.push(stepContract(name, i, ['valid', 'invalid']));
      // valid continues to next stage; invalid terminates.
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
      terminals[name] = [{ outcome: 'error', target: 'flow:terminate' }];
    } else {
      // Parse node steps: success continues, error terminates.
      contracts.push(stepContract(name, i, ['success', 'error']));
      terminals[name] = [{ outcome: 'error', target: null }];
    }
  }

  const annotations: DAGDeriverAnnotations = {
    ...(Object.keys(terminals).length > 0 ? { terminals } : {}),
    ...(Object.keys(subDAGs).length   > 0 ? { subDAGs }  : {}),
  };

  return DAGDeriver.derive({
    name:        dagName,
    version:     '2.0',
    entrypoint:  allSteps[0] as string,
    contracts,
    annotations,
  });
};
