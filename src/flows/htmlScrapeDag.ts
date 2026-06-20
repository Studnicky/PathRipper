import { DAGBuilder } from '@studnicky/dagonizer';
import type { DAGType } from '@studnicky/dagonizer';

import { CrawlListTargetsNode } from '../nodes/CrawlListTargetsNode.js';
import type { ScrapeState }     from '../state/ScrapeState.js';

/** Canonical name for the HTML initial-scrape phase DAG. */
export const HTML_SCRAPE_PHASE = 'htmlScrapePhase';
/** Canonical name for the HTML failure-retry phase DAG. */
export const HTML_RETRY_PHASE  = 'htmlRetryPhase';
/** Canonical name for the HTML crawl phase DAG. */
export const HTML_CRAWL_PHASE  = 'htmlCrawlPhase';
/** Canonical name for the outer HTML composition DAG (no-crawl path). */
export const HTML_SCRAPE_DAG      = 'htmlScrapeDAG';
/** Canonical name for the outer HTML composition DAG (crawl path). */
export const HTML_SCRAPE_DAG_CRAWL = 'htmlScrapeDAGCrawl';

const SCATTER_CONCURRENCY = 4;

// Every scatter aggregate outcome routes to the phase terminal; the partition
// gather has already written per-item results into the parent buckets.
const PHASE_OUTCOMES: Record<string, string> = {
  'all-success': 'phase-done',
  'partial':     'phase-done',
  'all-error':   'phase-done',
  'empty':       'phase-done',
};

/**
 * HTML initial-scrape phase: scatter over `state.urls`, dispatching the
 * registered per-page DAG named by `perPageDagName` once per URL, partitioning
 * each item's terminal outcome into `state.succeeded` / `state.failed`.
 *
 * @param perPageDagName - The registered DAG name the scatter body dispatches.
 *
 * @category Flows
 * @since 4.0.0
 */
export function buildHtmlScrapePhaseDag(perPageDagName: string): DAGType {
  return new DAGBuilder(HTML_SCRAPE_PHASE, '2.0')
    .scatter('scrape-urls', 'urls', { dag: perPageDagName }, PHASE_OUTCOMES, {
      itemKey:     'currentUrl',
      concurrency: SCATTER_CONCURRENCY,
      gather:      { strategy: 'partition', partitions: { success: 'succeeded', error: 'failed' } },
    })
    .terminal('phase-done', { outcome: 'completed' })
    .build();
}

/**
 * HTML failure-retry phase: scatter over `state.failed`, dispatching the
 * registered per-page DAG named by `perPageDagName` once per URL, partitioning
 * each item's terminal outcome into `state.recovered` / `state.failedAfterRetry`.
 *
 * @param perPageDagName - The registered DAG name the scatter body dispatches.
 *
 * @category Flows
 * @since 4.0.0
 */
export function buildHtmlRetryPhaseDag(perPageDagName: string): DAGType {
  return new DAGBuilder(HTML_RETRY_PHASE, '2.0')
    .scatter('retry-urls', 'failed', { dag: perPageDagName }, PHASE_OUTCOMES, {
      itemKey:     'currentUrl',
      concurrency: SCATTER_CONCURRENCY,
      gather:      { strategy: 'partition', partitions: { success: 'recovered', error: 'failedAfterRetry' } },
    })
    .terminal('phase-done', { outcome: 'completed' })
    .build();
}

/**
 * HTML crawl phase: runs `crawl:list-targets` once (cardinality 1), writing
 * discovered URLs into `state.urls`, then terminates.
 *
 * @category Flows
 * @since 4.0.0
 */
export function buildHtmlCrawlPhaseDag(): DAGType {
  return new DAGBuilder(HTML_CRAWL_PHASE, '2.0')
    .node('crawl:list-targets', CrawlListTargetsNode, {
      success: 'phase-done',
      error:   'phase-done',
      empty:   'phase-done',
    })
    .terminal('phase-done', { outcome: 'completed' })
    .build();
}

/**
 * Outer HTML composition DAG (no-crawl path): the scrape phase then the retry
 * phase, each an embedded DAG, terminating once retry completes.
 *
 * @category Flows
 * @since 4.0.0
 */
export function buildHtmlScrapeDag(): DAGType {
  return new DAGBuilder(HTML_SCRAPE_DAG, '2.0')
    .embeddedDAG<ScrapeState, ScrapeState>('scrape', HTML_SCRAPE_PHASE, { success: 'retry', error: 'retry' }, {
      inputs:  { urls: 'urls' },
      outputs: { succeeded: 'succeeded', failed: 'failed' },
    })
    .embeddedDAG<ScrapeState, ScrapeState>('retry', HTML_RETRY_PHASE, { success: 'scrape-done', error: 'scrape-done' }, {
      inputs:  { failed: 'failed' },
      outputs: { recovered: 'recovered', failedAfterRetry: 'failedAfterRetry' },
    })
    .terminal('scrape-done', { outcome: 'completed' })
    .build();
}

/**
 * Outer HTML composition DAG (crawl path): crawl phase discovers URLs, then
 * scrape phase processes them, then retry phase handles failures.
 *
 * @category Flows
 * @since 4.0.0
 */
export function buildHtmlScrapeDagCrawl(): DAGType {
  return new DAGBuilder(HTML_SCRAPE_DAG_CRAWL, '2.0')
    .embeddedDAG<ScrapeState, ScrapeState>('crawl', HTML_CRAWL_PHASE, { success: 'scrape', error: 'scrape-done' }, {
      outputs: { urls: 'urls' },
    })
    .embeddedDAG<ScrapeState, ScrapeState>('scrape', HTML_SCRAPE_PHASE, { success: 'retry', error: 'retry' }, {
      inputs:  { urls: 'urls' },
      outputs: { succeeded: 'succeeded', failed: 'failed' },
    })
    .embeddedDAG<ScrapeState, ScrapeState>('retry', HTML_RETRY_PHASE, { success: 'scrape-done', error: 'scrape-done' }, {
      inputs:  { failed: 'failed' },
      outputs: { recovered: 'recovered', failedAfterRetry: 'failedAfterRetry' },
    })
    .terminal('scrape-done', { outcome: 'completed' })
    .build();
}
