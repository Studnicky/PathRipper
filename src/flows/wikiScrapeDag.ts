import { DAGBuilder } from '@studnicky/dagonizer';
import type { DAGType, NodeInterface } from '@studnicky/dagonizer';

import type { ScrapeState }    from '../state/ScrapeState.js';
import type { RipperServices } from '../services/RipperServices.js';

/** Canonical name for the wiki initial-scrape phase DAG. */
export const WIKI_SCRAPE_PHASE = 'wikiScrapePhase';
/** Canonical name for the wiki failure-retry phase DAG. */
export const WIKI_RETRY_PHASE = 'wikiRetryPhase';
/** Canonical name for the outer wiki composition DAG. */
export const WIKI_SCRAPE_DAG = 'wikiScrapeDAG';

/** The per-page dispatch node a scrape phase scatters over. */
export type WikiDispatchNode = NodeInterface<ScrapeState, string, RipperServices>;

const SCATTER_CONCURRENCY = 8;

// Every scatter outcome routes to the phase terminal; the partition gather has
// already written the per-item results into the parent buckets.
const PHASE_OUTCOMES: Record<string, string> = {
  'all-success': 'phase-done',
  'partial':     'phase-done',
  'all-error':   'phase-done',
  'empty':       'phase-done',
};

/**
 * Wiki initial-scrape phase: scatter over `state.titles`, dispatching the
 * per-page node once per title, partitioning each item's `success`/`error`
 * output into `state.succeeded` / `state.failed`.
 *
 * @category Flows
 * @since 4.0.0
 */
export function buildWikiScrapePhaseDag(dispatchNode: WikiDispatchNode): DAGType {
  return new DAGBuilder(WIKI_SCRAPE_PHASE, '2.0')
    .scatter('scrape-titles', 'titles', dispatchNode, PHASE_OUTCOMES, {
      itemKey:     'currentTitle',
      concurrency: SCATTER_CONCURRENCY,
      gather:      { strategy: 'partition', partitions: { success: 'succeeded', error: 'failed' } },
    })
    .terminal('phase-done', { outcome: 'completed' })
    .build();
}

/**
 * Wiki failure-retry phase: scatter over `state.failed`, partitioning each
 * item's `success`/`error` output into `state.recovered` /
 * `state.failedAfterRetry`.
 *
 * @category Flows
 * @since 4.0.0
 */
export function buildWikiRetryPhaseDag(dispatchNode: WikiDispatchNode): DAGType {
  return new DAGBuilder(WIKI_RETRY_PHASE, '2.0')
    .scatter('retry-titles', 'failed', dispatchNode, PHASE_OUTCOMES, {
      itemKey:     'currentRetryTitle',
      concurrency: SCATTER_CONCURRENCY,
      gather:      { strategy: 'partition', partitions: { success: 'recovered', error: 'failedAfterRetry' } },
    })
    .terminal('phase-done', { outcome: 'completed' })
    .build();
}

/**
 * Outer wiki composition: the scrape phase then the retry phase, each an
 * embedded DAG, terminating once retry completes.
 *
 * @category Flows
 * @since 4.0.0
 */
export function buildWikiScrapeDag(): DAGType {
  return new DAGBuilder(WIKI_SCRAPE_DAG, '2.0')
    .embeddedDAG('scrape', WIKI_SCRAPE_PHASE, { success: 'retry', error: 'retry' }, {
      outputs: { succeeded: 'succeeded', failed: 'failed' },
    })
    .embeddedDAG('retry', WIKI_RETRY_PHASE, { success: 'scrape-done', error: 'scrape-done' }, {
      outputs: { recovered: 'recovered', failedAfterRetry: 'failedAfterRetry' },
    })
    .terminal('scrape-done', { outcome: 'completed' })
    .build();
}
