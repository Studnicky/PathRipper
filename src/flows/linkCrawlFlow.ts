/**
 * linkCrawlFlow — trampolined recursive link crawler flow.
 *
 * ## Strategy: trampolined dispatch (dynamic recursion)
 *
 * The prior 16-level unrolled `DAGBuilder` approach is replaced with two flat
 * `DAGDeriver.derive(...)` flows sharing the same crawl node set:
 *
 *   - `linkCrawlDAG`      — outer DAG: init-frontier + one level + recurse/done.
 *   - `linkCrawlLevelDAG` — inner DAG: one level + recurse/done (no init).
 *
 * `crawl:recurse` is a `SingleNode` whose `execute()` body calls
 * `services.dispatcher.execute('linkCrawlLevelDAG', state)` at runtime with the
 * same `state` reference. Because the reference is dynamic (not a static
 * `DeepDAGNode` placement), Dagonizer's `collectDeepDAGReferences` cycle check
 * (`Dagonizer.ts`) is silent on it and the static DAG graph remains acyclic.
 * The `state` reference passed to `dispatcher.execute` is the same object
 * created by `LinkLister.buildList`, so all node mutations (discovered URLs,
 * depth increments, frontier swaps) accumulate in-place across all levels.
 *
 * ## Termination
 *
 * `DedupeAndEnqueueNode` routes `frontier-empty` / `budget-exhausted` to
 * `crawl:exhausted` (skipping recurse), stopping the trampoline. `crawl:recurse`
 * adds a second guard (`state.frontier.length > 0`) to prevent runaway in edge
 * cases. Effective depth is bounded by the existing `state.maxDepth` runtime
 * check in `DedupeAndEnqueueNode`.
 *
 * ## Static cycle check
 *
 * Both `linkCrawlDAG` and `linkCrawlLevelDAG` contain only `SingleNode`,
 * `ParallelNode`, and `FanOutNode` placements — no `DeepDAGNode`. Dagonizer's
 * `collectDeepDAGReferences` walks only `DeepDAGNode` placements, so neither
 * DAG references the other statically. No cycle detected.
 *
 * ## Shape
 *
 *   linkCrawlDAG (5 placements):
 *     crawl:init-frontier     { ready → crawl:fetch-and-extract, empty → crawl:exhausted }
 *     crawl:fetch-and-extract { success/empty/error/permanent → crawl:dedupe-and-enqueue }
 *     crawl:dedupe-and-enqueue { frontier-ready → crawl:recurse, frontier-empty/budget-exhausted → crawl:exhausted }
 *     crawl:recurse           { success → null }  ← trampoline: re-dispatches linkCrawlLevelDAG
 *     crawl:exhausted         { success → null }
 *
 *   linkCrawlLevelDAG (4 placements — same as above minus init):
 *     crawl:fetch-and-extract  { success/empty/error/permanent → crawl:dedupe-and-enqueue }
 *     crawl:dedupe-and-enqueue { frontier-ready → crawl:recurse, frontier-empty/budget-exhausted → crawl:exhausted }
 *     crawl:recurse            { success → null }
 *     crawl:exhausted          { success → null }
 */

import { DAGDeriver } from '@noocodex/dagonizer/derive';
import type { DAG } from '@noocodex/dagonizer';

import { LINK_CRAWL_LEVEL_DAG_NAME } from '../nodes/crawl/RecurseCrawlNode.js';

/** Canonical name of the link-crawl outer flow. */
export const LINK_CRAWL_FLOW_NAME = 'linkCrawlDAG';

/** Re-export for consumers that register both DAGs. */
export { LINK_CRAWL_LEVEL_DAG_NAME };

/**
 * Builds the outer link-crawl DAG and the inner level DAG.
 *
 * Both DAGs must be registered on the dispatcher before dispatching.
 * Registration order: level DAG first (crawl:recurse dispatches it dynamically;
 * the dispatcher validates referenced DAG names at registration time for
 * DeepDAGNode placements only — dynamic dispatch is validated at runtime).
 *
 * @returns `{ linkCrawlDAG, linkCrawlLevelDAG }` — both ready for `dispatcher.registerDAG()`.
 *
 * @category Flows
 * @since 4.0.0
 */
export const buildLinkCrawlFlow = (): { linkCrawlDAG: DAG; linkCrawlLevelDAG: DAG } => {
  // ── Shared terminal contract set ───────────────────────────────────────────
  // crawl:recurse and crawl:exhausted are routing targets with no data dependency;
  // they appear as depth-N siblings in both DAGs (same pattern as wikiResolveMembersFlow
  // branch nodes). All three ports of dedupe-and-enqueue are overridden via terminals.
  const levelAnnotations = {
    terminals: {
      'crawl:dedupe-and-enqueue': [
        { outcome: 'frontier-ready',   target: 'crawl:recurse'   },
        { outcome: 'frontier-empty',   target: 'crawl:exhausted' },
        { outcome: 'budget-exhausted', target: 'crawl:exhausted' },
      ],
      'crawl:recurse':   [{ outcome: 'success', target: null }],
      'crawl:exhausted': [{ outcome: 'success', target: null }],
    },
  };

  // ── linkCrawlLevelDAG ──────────────────────────────────────────────────────
  // Inner trampoline target: fetch → dedupe → recurse | exhausted.
  // All four fetch-and-extract outputs route uniformly to dedupe (auto-wired).
  const linkCrawlLevelDAG: DAG = DAGDeriver.derive({
    name:       LINK_CRAWL_LEVEL_DAG_NAME,
    version:    '2.0',
    entrypoint: 'crawl:fetch-and-extract',
    contracts: [
      {
        name:         'crawl:fetch-and-extract',
        hardRequired: ['frontier'],
        produces:     ['discoveredRaw'],
        outputs:      ['success', 'empty', 'error', 'permanent'],
      },
      {
        name:         'crawl:dedupe-and-enqueue',
        hardRequired: ['discoveredRaw'],
        produces:     ['next-frontier'],
        outputs:      ['frontier-ready', 'frontier-empty', 'budget-exhausted'],
      },
      {
        name:         'crawl:recurse',
        hardRequired: [],
        produces:     [],
        outputs:      ['success'],
      },
      {
        name:         'crawl:exhausted',
        hardRequired: [],
        produces:     [],
        outputs:      ['success'],
      },
    ],
    annotations: levelAnnotations,
  });

  // ── linkCrawlDAG ──────────────────────────────────────────────────────────
  // Outer DAG: init-frontier + the same level chain.
  // init-frontier routes:
  //   ready → crawl:fetch-and-extract (via data graph: init produces 'frontier',
  //           fetch requires 'frontier')
  //   empty → crawl:exhausted (terminal)
  const linkCrawlDAG: DAG = DAGDeriver.derive({
    name:       LINK_CRAWL_FLOW_NAME,
    version:    '2.0',
    entrypoint: 'crawl:init-frontier',
    contracts: [
      {
        name:         'crawl:init-frontier',
        hardRequired: ['seedUrls'],
        produces:     ['frontier'],
        outputs:      ['ready', 'empty'],
      },
      {
        name:         'crawl:fetch-and-extract',
        hardRequired: ['frontier'],
        produces:     ['discoveredRaw'],
        outputs:      ['success', 'empty', 'error', 'permanent'],
      },
      {
        name:         'crawl:dedupe-and-enqueue',
        hardRequired: ['discoveredRaw'],
        produces:     ['next-frontier'],
        outputs:      ['frontier-ready', 'frontier-empty', 'budget-exhausted'],
      },
      {
        name:         'crawl:recurse',
        hardRequired: [],
        produces:     [],
        outputs:      ['success'],
      },
      {
        name:         'crawl:exhausted',
        hardRequired: [],
        produces:     [],
        outputs:      ['success'],
      },
    ],
    annotations: {
      terminals: {
        'crawl:init-frontier':     [{ outcome: 'empty', target: 'crawl:exhausted' }],
        ...levelAnnotations.terminals,
      },
    },
  });

  return { linkCrawlDAG, linkCrawlLevelDAG };
};
