import { DAGBuilder } from '@studnicky/dagonizer';
import type { DAGType } from '@studnicky/dagonizer';

/** Canonical name for the wiki initial-scrape phase DAG. */
export const WIKI_SCRAPE_PHASE = 'wikiScrapePhase';
/** Canonical name for the wiki failure-retry phase DAG. */
export const WIKI_RETRY_PHASE = 'wikiRetryPhase';
/** Canonical name for the outer wiki composition DAG. */
export const WIKI_SCRAPE_DAG = 'wikiScrapeDAG';

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
 * registered per-page DAG named by `perPageDagName` once per title, partitioning
 * each item's terminal outcome into `state.succeeded` / `state.failed`.
 *
 * @param perPageDagName - The registered DAG name the scatter body dispatches.
 *
 * @category Flows
 * @since 4.0.0
 */
export function buildWikiScrapePhaseDag(perPageDagName: string): DAGType {
  return new DAGBuilder(WIKI_SCRAPE_PHASE, '2.0')
    .scatter('scrape-titles', 'titles', { dag: perPageDagName }, PHASE_OUTCOMES, {
      itemKey:     'currentTitle',
      concurrency: SCATTER_CONCURRENCY,
      gather:      { strategy: 'partition', partitions: { success: 'succeeded', error: 'failed' } },
    })
    .terminal('phase-done', { outcome: 'completed' })
    .build();
}

/**
 * Wiki failure-retry phase: scatter over `state.failed`, dispatching the
 * registered per-page DAG named by `perPageDagName` once per failed title,
 * partitioning each item's terminal outcome into `state.recovered` /
 * `state.failedAfterRetry`.
 *
 * @param perPageDagName - The registered DAG name the scatter body dispatches.
 *
 * @category Flows
 * @since 4.0.0
 */
export function buildWikiRetryPhaseDag(perPageDagName: string): DAGType {
  return new DAGBuilder(WIKI_RETRY_PHASE, '2.0')
    .scatter('retry-titles', 'failed', { dag: perPageDagName }, PHASE_OUTCOMES, {
      itemKey:     'currentTitle',
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
