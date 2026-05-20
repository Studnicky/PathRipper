/**
 * htmlScrapeFlow — contract-derived replacement for:
 *   - htmlScrapePhase (fan-out scrape pass)
 *   - htmlRetryPhase  (fan-out retry pass)
 *   - htmlCrawlPhase  (optional URL discovery pass)
 *   - htmlScrapeDAG / htmlScrapeDAGCrawl (outer composition)
 *
 * **Phase DAGs** — expressed as separate `DAGDeriver.derive` calls with
 * `annotations.fanouts` for the fan-out placements and `annotations.terminals`
 * for alternate exit routing. The `fanInOperation` is excluded from the
 * top-level contract chain (DAGDeriver filters fan-in names from `eligibleContracts`).
 *
 * **Outer composition** — the outer DAGs (`htmlScrapeFlow`, `htmlScrapeFlowCrawl`)
 * wrap the phase flows as `DeepDAGNode` placements via `annotations.subDAGs`
 * (adopted in 0.7.0). Each phase step is an operation contract; the `subDAGs`
 * annotation declares the registered DAG name so DAGDeriver renders
 * `DeepDAGNode` instead of `SingleNode`.
 *
 * **Crawl phase** — single-contract flow whose only operation is
 * `crawl:list-targets` (produces `urls`); alternate exits terminate via
 * `annotations.terminals`.
 */

import { DAGDeriver } from '@noocodex/dagonizer/derive';
import type { OperationContract } from '@noocodex/dagonizer/derive';
import type { DAG } from '@noocodex/dagonizer';

// ── Phase names ────────────────────────────────────────────────────────────────

/** Canonical name for the HTML initial-scrape phase flow. */
export const HTML_SCRAPE_PHASE_FLOW = 'htmlScrapePhase';

/** Canonical name for the HTML failure-retry phase flow. */
export const HTML_RETRY_PHASE_FLOW = 'htmlRetryPhase';

/** Canonical name for the HTML URL-discovery phase flow. */
export const HTML_CRAWL_PHASE_FLOW = 'htmlCrawlPhase';

// ── htmlCrawlPhase ─────────────────────────────────────────────────────────────

const crawlContracts: readonly OperationContract[] = [
  { name: 'crawl:list-targets', hardRequired: [], produces: ['urls'], outputs: ['success', 'error', 'empty'] },
];

/**
 * Contract-derived HTML URL-discovery phase.
 * Populates `state.urls` from the crawl config; alternate exits terminate.
 *
 * @category Flows
 * @since 4.0.0
 */
export const htmlCrawlPhaseFlow: DAG = DAGDeriver.derive({
  name:       HTML_CRAWL_PHASE_FLOW,
  version:    '2.0',
  entrypoint: 'crawl:list-targets',
  contracts:  crawlContracts,
  annotations: {
    terminals: {
      'crawl:list-targets': [
        { outcome: 'error', target: null },
        { outcome: 'empty', target: null },
      ],
    },
  },
});

// ── htmlScrapePhase ────────────────────────────────────────────────────────────

/**
 * Contract-derived HTML initial-scrape phase (fan-out over `state.urls`).
 *
 * @category Flows
 * @since 4.0.0
 */
export const htmlScrapePhaseFlow: DAG = DAGDeriver.derive({
  name:       HTML_SCRAPE_PHASE_FLOW,
  version:    '2.0',
  entrypoint: 'scrape-urls',
  contracts: [
    { name: 'scrape-urls',    hardRequired: ['urls'],      produces: ['succeeded', 'failed'], outputs: ['all-success', 'partial', 'all-error', 'empty'] },
    { name: 'html:partition', hardRequired: ['succeeded'], produces: [],                      outputs: ['success'] },
  ],
  annotations: {
    fanouts: {
      'scrape-urls': {
        source:         'urls',
        itemKey:        'currentUrl',
        concurrency:    4,
        node:           'scrape-urls',
        strategy:       'custom',
        fanInOperation: 'html:partition',
        outcomes:       ['all-success', 'partial', 'all-error', 'empty'],
      },
    },
    terminals: {
      'scrape-urls': [
        { outcome: 'all-success', target: null },
        { outcome: 'partial',     target: null },
        { outcome: 'all-error',   target: null },
        { outcome: 'empty',       target: null },
      ],
    },
  },
});

// ── htmlRetryPhase ─────────────────────────────────────────────────────────────

/**
 * Contract-derived HTML failure-retry phase (fan-out over `state.failed`).
 *
 * @category Flows
 * @since 4.0.0
 */
export const htmlRetryPhaseFlow: DAG = DAGDeriver.derive({
  name:       HTML_RETRY_PHASE_FLOW,
  version:    '2.0',
  entrypoint: 'retry-urls',
  contracts: [
    { name: 'retry-urls',          hardRequired: ['failed'],    produces: ['recovered', 'failedAfterRetry'], outputs: ['all-success', 'partial', 'all-error', 'empty'] },
    { name: 'html:retryPartition', hardRequired: ['recovered'], produces: [],                               outputs: ['success'] },
  ],
  annotations: {
    fanouts: {
      'retry-urls': {
        source:         'failed',
        itemKey:        'currentRetryUrl',
        concurrency:    4,
        node:           'retry-urls',
        strategy:       'custom',
        fanInOperation: 'html:retryPartition',
        outcomes:       ['all-success', 'partial', 'all-error', 'empty'],
      },
    },
    terminals: {
      'retry-urls': [
        { outcome: 'all-success', target: null },
        { outcome: 'partial',     target: null },
        { outcome: 'all-error',   target: null },
        { outcome: 'empty',       target: null },
      ],
    },
  },
});

// ── Outer composition DAGs ─────────────────────────────────────────────────────

// Phase operations for the outer composition chain. Each phase has a unique
// fictional produce key so DAGDeriver can chain them linearly:
//   scrape (produces: scrape-done) → retry (produces: retry-done) → done
//
// All outputs of scrape and retry route uniformly to the next derived stage
// (DAGDeriver auto-wires all declared ports), matching the previous DAGBuilder
// { success: next, error: next } routing.

const SCRAPE_OUTPUT_MAPPING: Readonly<Record<string, string>> = { succeeded: 'succeeded', failed: 'failed' };
const RETRY_OUTPUT_MAPPING:  Readonly<Record<string, string>> = { recovered: 'recovered', failedAfterRetry: 'failedAfterRetry' };
const CRAWL_OUTPUT_MAPPING:  Readonly<Record<string, string>> = { urls: 'urls' };

/**
 * Outer HTML scrape flow (no discovery phase).
 *
 * Operations:
 *   scrape (DeepDAG: htmlScrapePhase) → retry (DeepDAG: htmlRetryPhase) → done
 *
 * @category Flows
 * @since 4.0.0
 */
export const htmlScrapeFlow: DAG = DAGDeriver.derive({
  name:       'htmlScrapeDAG',
  version:    '2.0',
  entrypoint: 'scrape',
  contracts: [
    { name: 'scrape',         hardRequired: [],             produces: ['scrape-done'], outputs: ['success', 'error'] },
    { name: 'retry',          hardRequired: ['scrape-done'], produces: ['retry-done'], outputs: ['success', 'error'] },
    { name: 'flow:terminate', hardRequired: ['retry-done'],  produces: [],             outputs: ['success'] },
  ],
  annotations: {
    subDAGs: {
      scrape: { dag: HTML_SCRAPE_PHASE_FLOW, outputs: ['success', 'error'], stateMapping: { output: SCRAPE_OUTPUT_MAPPING } },
      retry:  { dag: HTML_RETRY_PHASE_FLOW,  outputs: ['success', 'error'], stateMapping: { output: RETRY_OUTPUT_MAPPING  } },
    },
    terminals: {
      'flow:terminate': [{ outcome: 'success', target: null }],
    },
  },
});

/**
 * Outer HTML scrape flow with URL-discovery phase.
 *
 * Operations:
 *   crawl (DeepDAG: htmlCrawlPhase) → scrape (DeepDAG: htmlScrapePhase)
 *     → retry (DeepDAG: htmlRetryPhase) → done
 *
 * crawl error exits to done (not scrape) via terminal annotation.
 *
 * @category Flows
 * @since 4.0.0
 */
export const htmlScrapeFlowCrawl: DAG = DAGDeriver.derive({
  name:       'htmlScrapeDAGCrawl',
  version:    '2.0',
  entrypoint: 'crawl',
  contracts: [
    { name: 'crawl',          hardRequired: [],              produces: ['crawl-done'],  outputs: ['success', 'error'] },
    { name: 'scrape',         hardRequired: ['crawl-done'],  produces: ['scrape-done'], outputs: ['success', 'error'] },
    { name: 'retry',          hardRequired: ['scrape-done'], produces: ['retry-done'],  outputs: ['success', 'error'] },
    { name: 'flow:terminate', hardRequired: ['retry-done'],  produces: [],              outputs: ['success'] },
  ],
  annotations: {
    subDAGs: {
      crawl:  { dag: HTML_CRAWL_PHASE_FLOW,  outputs: ['success', 'error'], stateMapping: { output: CRAWL_OUTPUT_MAPPING  } },
      scrape: { dag: HTML_SCRAPE_PHASE_FLOW, outputs: ['success', 'error'], stateMapping: { output: SCRAPE_OUTPUT_MAPPING } },
      retry:  { dag: HTML_RETRY_PHASE_FLOW,  outputs: ['success', 'error'], stateMapping: { output: RETRY_OUTPUT_MAPPING  } },
    },
    terminals: {
      // crawl error routes directly to flow:terminate (skip scrape when discovery fails)
      crawl:            [{ outcome: 'error', target: 'flow:terminate' }],
      'flow:terminate': [{ outcome: 'success', target: null }],
    },
  },
});
