import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContract } from '@noocodex/dagonizer/contracts';

import type { LinkCrawlState }   from '../../state/LinkCrawlState.js';
import type { LinkCrawlServices } from './Services.js';

/** Canonical name of the level DAG that recurse dispatches back into. */
export const LINK_CRAWL_LEVEL_DAG_NAME = 'linkCrawlLevelDAG';

/**
 * Trampoline node for the link-crawl level DAG.
 *
 * ## Design
 *
 * After `DedupeAndEnqueueNode` routes `frontier-ready`, this node re-dispatches
 * the level DAG via `services.dispatcher.execute('linkCrawlLevelDAG', clone)`.
 * A **clone** is used rather than the original state because `NodeStateBase`'s
 * lifecycle FSM (`DAGLifecycleMachine`) disallows re-entering `running` state:
 * calling `dispatcher.execute(name, state)` calls `state.markRunning()` at the
 * top of `Dagonizer.runNodes`; if the state is already `running` (from the
 * outer `linkCrawlDAG` execution), the engine throws `DAGError: Cannot mark
 * running: lifecycle is running`.
 *
 * `state.clone()` (implemented by `LinkCrawlState`) creates a new instance with
 * `pending` lifecycle and copies all domain fields. After the recursive execute
 * completes, accumulated state (`discovered`, `visited`, `depth`, `frontier`,
 * `discoveredRaw`, `nextFrontierRaw`) is copied back to the original state so
 * the outer execution sees the full crawl result.
 *
 * ## Termination
 *
 * `DedupeAndEnqueueNode` routes `frontier-empty` / `budget-exhausted` to
 * `crawl:exhausted` (bypassing `crawl:recurse`), stopping the trampoline.
 * `RecurseCrawlNode` adds a second guard (`clone.frontier.length > 0`) to
 * prevent runaway in edge cases.
 *
 * ## Static cycle check
 *
 * `Dagonizer.collectDeepDAGReferences` walks only `DeepDAGNode` placements.
 * `linkCrawlDAG` and `linkCrawlLevelDAG` contain only `SingleNode` placements
 * (no `DeepDAGNode`). Dynamic dispatch via `services.dispatcher.execute` is
 * invisible to the cycle checker. The static graph remains acyclic.
 *
 * Output ports:
 * - `success` — always; returned after the recursive dispatch completes.
 *
 * @category Nodes
 * @since 4.0.0
 */
export const RecurseCrawlNode: NodeInterface<LinkCrawlState, 'success', LinkCrawlServices> = {
  name: 'crawl:recurse',
  outputs: ['success'],

  async execute(
    state: LinkCrawlState,
    context: NodeContextInterface<LinkCrawlServices>,
  ): Promise<{ output: 'success' }> {
    const { services } = context;

    // Guard: only trampoline if there's actually work remaining.
    if (state.frontier.length === 0) {
      return { output: 'success' };
    }

    services.log.debug(
      'RecurseCrawlNode',
      `Trampolining level DAG at depth ${state.depth.toString()} with ${state.frontier.length.toString()} URLs`,
    );

    // Clone state to get a fresh lifecycle (`pending`). The outer execution's
    // state lifecycle is `running` — `dispatcher.execute` would call markRunning()
    // and fail with "Cannot mark running: lifecycle is running".
    const clone = state.clone() as LinkCrawlState;

    await services.dispatcher.execute(LINK_CRAWL_LEVEL_DAG_NAME, clone);

    // Merge accumulated crawl result back to the original state.
    // The clone accumulated discovered URLs, updated visited, and advanced depth.
    state.discovered       = clone.discovered;
    state.visited          = clone.visited;
    state.depth            = clone.depth;
    state.frontier         = clone.frontier;
    state.discoveredRaw    = clone.discoveredRaw;
    state.nextFrontierRaw  = clone.nextFrontierRaw;

    return { output: 'success' };
  },
};

/** OperationContract for RecurseCrawlNode: no data dependency (routing target only). */
export const recurseCrawlContract: OperationContract = {
  name:         'crawl:recurse',
  hardRequired: [],
  produces:     [],
  outputs:      ['success'],
};
