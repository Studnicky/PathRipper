/**
 * linkCrawlFlow — native cyclic-DAG link crawler flow.
 *
 * ## Strategy: native back-edge loop
 *
 * A single `DAGBuilder` flow drives all depth levels through a back-edge from
 * `crawl:dedupe-and-enqueue` back to `crawl:fetch-and-extract`. The dagonizer
 * engine re-executes the target placement in place — no second DAG, no
 * trampoline, no clone.
 *
 * State mutates in place across every loop iteration. `frontier`, `visited`,
 * `discovered`, and `depth` accumulate on the same `LinkCrawlState` instance
 * across all levels.
 *
 * ## Termination
 *
 * `DedupeAndEnqueueNode` holds the loop guard. It routes `frontier-empty` /
 * `budget-exhausted` to `crawl:exhausted` when the depth limit, page budget, or
 * natural frontier exhaustion is reached — exiting the back-edge loop and
 * terminating the DAG. `frontier-ready` routes back to `crawl:fetch-and-extract`
 * to begin the next level.
 *
 * ## Shape (5 placements — 3 nodes + 2 terminals, one cyclic back-edge)
 *
 *   crawl:init-frontier      { ready → crawl:fetch-and-extract, empty → crawl:exhausted }
 *   crawl:fetch-and-extract  { success/empty/error/permanent → crawl:dedupe-and-enqueue }
 *   crawl:dedupe-and-enqueue { frontier-ready → crawl:fetch-and-extract  ← BACK-EDGE
 *                              frontier-empty/budget-exhausted → crawl:exhausted }
 *   crawl:exhausted          { success → crawl:completed }
 *   crawl:completed          terminal (outcome: completed)
 */

import { DAGBuilder } from '@studnicky/dagonizer';
import type { DAGType } from '@studnicky/dagonizer';

import { InitFrontierNode }         from '../nodes/crawl/InitFrontierNode.js';
import { FetchAndExtractLinksNode } from '../nodes/crawl/FetchAndExtractLinksNode.js';
import { DedupeAndEnqueueNode }     from '../nodes/crawl/DedupeAndEnqueueNode.js';
import { CrawlExhaustedNode }       from '../nodes/crawl/CrawlExhaustedNode.js';

/** Canonical name of the link-crawl flow DAG. */
export const LINK_CRAWL_FLOW_NAME = 'linkCrawlDAG';

/**
 * Builds the cyclic link-crawl DAG.
 *
 * The DAG contains a back-edge from `crawl:dedupe-and-enqueue` to
 * `crawl:fetch-and-extract`. The dagonizer scheduler re-executes the target
 * placement on the same in-place state until the loop guard in
 * `DedupeAndEnqueueNode` routes to `crawl:exhausted`.
 *
 * @returns The `linkCrawlDAG` ready for `dispatcher.registerDAG()`.
 *
 * @category Flows
 * @since 4.0.0
 */
export const buildLinkCrawlFlow = (): DAGType => {
  return new DAGBuilder(LINK_CRAWL_FLOW_NAME, '2.0')
    .node('crawl:init-frontier', InitFrontierNode, {
      ready: 'crawl:fetch-and-extract',
      empty: 'crawl:exhausted',
    })
    .node('crawl:fetch-and-extract', FetchAndExtractLinksNode, {
      success:   'crawl:dedupe-and-enqueue',
      empty:     'crawl:dedupe-and-enqueue',
      error:     'crawl:dedupe-and-enqueue',
      permanent: 'crawl:dedupe-and-enqueue',
    })
    .node('crawl:dedupe-and-enqueue', DedupeAndEnqueueNode, {
      'frontier-ready':   'crawl:fetch-and-extract',
      'frontier-empty':   'crawl:exhausted',
      'budget-exhausted': 'crawl:exhausted',
    })
    .node('crawl:exhausted', CrawlExhaustedNode, {
      success: 'crawl:completed',
    })
    .terminal('crawl:completed', { outcome: 'completed' })
    .build();
};
