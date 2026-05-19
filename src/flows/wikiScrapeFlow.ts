/**
 * wikiScrapeFlow — contract-derived replacement for:
 *   - wikiScrapePhase (fan-out scrape pass)
 *   - wikiRetryPhase  (fan-out retry pass)
 *   - wikiResolveMembersDAG (member resolution DAG)
 *   - wikiScrapeDAG (outer composition)
 *
 * **Phase DAGs** — expressed as `FlowDeriver.derive` calls with
 * `annotations.fanouts` for fan-out placements and `annotations.terminals`
 * for alternate exit routing. Same structure as htmlScrapeFlow phases.
 *
 * **wikiResolveMembersFlow** — branching flow where `wiki:choose-mode` routes
 * to one of four branch nodes via `annotations.terminals` with non-null
 * `target` values (textbook non-null terminal routing). Each branch terminates
 * with `{ success: null, error: null }` terminals.
 *
 * **Outer composition** — the outer `wikiScrapeFlow` wraps the phase flows as
 * `DeepDAGNode` placements via `annotations.subDAGs` (adopted in 0.7.0). Each
 * phase step is an operation contract; the `subDAGs` annotation declares the
 * registered DAG name so FlowDeriver renders `DeepDAGNode` instead of `SingleNode`.
 */

import { FlowDeriver } from '@noocodex/dagonizer/derive';
import type { OperationContract } from '@noocodex/dagonizer/derive';
import type { DAG } from '@noocodex/dagonizer';

// ── Phase names ────────────────────────────────────────────────────────────────

/** Canonical name for the wiki initial-scrape phase flow. */
export const WIKI_SCRAPE_PHASE_FLOW = 'wikiScrapePhase';

/** Canonical name for the wiki failure-retry phase flow. */
export const WIKI_RETRY_PHASE_FLOW = 'wikiRetryPhase';

/** Canonical name for the wiki member-resolution flow. */
export const WIKI_RESOLVE_MEMBERS_FLOW = 'wikiResolveMembersDAG';

// ── wikiScrapePhase ────────────────────────────────────────────────────────────

/**
 * Contract-derived wiki initial-scrape phase (fan-out over `state.titles`).
 *
 * @category Flows
 * @since 4.0.0
 */
export const wikiScrapePhaseFlow: DAG = FlowDeriver.derive({
  name:       WIKI_SCRAPE_PHASE_FLOW,
  version:    '2.0',
  entrypoint: 'scrape-titles',
  contracts: [
    { name: 'scrape-titles',  hardRequired: ['titles'],    produces: ['succeeded', 'failed'], outputs: ['all-success', 'partial', 'all-error', 'empty'] },
    { name: 'wiki:partition', hardRequired: ['succeeded'], produces: [],                      outputs: ['success'] },
  ],
  annotations: {
    fanouts: {
      'scrape-titles': {
        source:         'titles',
        itemKey:        'currentTitle',
        concurrency:    8,
        fanInOperation: 'wiki:partition',
        outcomes:       ['all-success', 'partial', 'all-error', 'empty'],
      },
    },
    terminals: {
      'scrape-titles': [
        { outcome: 'all-success', target: null },
        { outcome: 'partial',     target: null },
        { outcome: 'all-error',   target: null },
        { outcome: 'empty',       target: null },
      ],
    },
  },
});

// ── wikiRetryPhase ─────────────────────────────────────────────────────────────

/**
 * Contract-derived wiki failure-retry phase (fan-out over `state.failed`).
 *
 * @category Flows
 * @since 4.0.0
 */
export const wikiRetryPhaseFlow: DAG = FlowDeriver.derive({
  name:       WIKI_RETRY_PHASE_FLOW,
  version:    '2.0',
  entrypoint: 'retry-titles',
  contracts: [
    { name: 'retry-titles',        hardRequired: ['failed'],    produces: ['recovered', 'failedAfterRetry'], outputs: ['all-success', 'partial', 'all-error', 'empty'] },
    { name: 'wiki:retryPartition', hardRequired: ['recovered'], produces: [],                               outputs: ['success'] },
  ],
  annotations: {
    fanouts: {
      'retry-titles': {
        source:         'failed',
        itemKey:        'currentRetryTitle',
        concurrency:    8,
        fanInOperation: 'wiki:retryPartition',
        outcomes:       ['all-success', 'partial', 'all-error', 'empty'],
      },
    },
    terminals: {
      'retry-titles': [
        { outcome: 'all-success', target: null },
        { outcome: 'partial',     target: null },
        { outcome: 'all-error',   target: null },
        { outcome: 'empty',       target: null },
      ],
    },
  },
});

// ── wikiResolveMembersFlow ─────────────────────────────────────────────────────

/**
 * Contract-derived wiki member-resolution flow.
 *
 * Shape:
 *   choose-mode → {
 *     resume-failures:  wiki:resume-failures           → END
 *     single-category:  wiki:fetch-single-category     → END
 *     by-categories:    wiki:fetch-multiple-categories → END
 *     all-pages:        wiki:fetch-all-pages            → END
 *   }
 *
 * The four branch nodes all produce `members` but have no shared `hardRequired`
 * path, so they appear as depth-1 siblings. `choose-mode` has no produces, so
 * the data graph cannot link it to its branches. We wire the branches using
 * `terminals` annotations on `wiki:choose-mode` to route each named output to
 * the correct branch node, with each branch terminating via its own terminal.
 *
 * @category Flows
 * @since 4.0.0
 */

const resolveMembersContracts: readonly OperationContract[] = [
  { name: 'wiki:choose-mode',              hardRequired: [],          produces: [],         outputs: ['resume-failures', 'single-category', 'by-categories', 'all-pages'] },
  { name: 'wiki:resume-failures',          hardRequired: [],          produces: ['members'], outputs: ['success', 'error'] },
  { name: 'wiki:fetch-single-category',    hardRequired: ['category'], produces: ['members'], outputs: ['success', 'error'] },
  { name: 'wiki:fetch-multiple-categories',hardRequired: [],          produces: ['members'], outputs: ['success', 'error'] },
  { name: 'wiki:fetch-all-pages',          hardRequired: [],          produces: ['members'], outputs: ['success', 'error'] },
];

export const wikiResolveMembersFlow: DAG = FlowDeriver.derive({
  name:       WIKI_RESOLVE_MEMBERS_FLOW,
  version:    '2.0',
  entrypoint: 'wiki:choose-mode',
  contracts:  resolveMembersContracts,
  annotations: {
    terminals: {
      'wiki:choose-mode': [
        { outcome: 'resume-failures',  target: 'wiki:resume-failures'           },
        { outcome: 'single-category',  target: 'wiki:fetch-single-category'     },
        { outcome: 'by-categories',    target: 'wiki:fetch-multiple-categories' },
        { outcome: 'all-pages',        target: 'wiki:fetch-all-pages'           },
      ],
      'wiki:resume-failures': [
        { outcome: 'success', target: null },
        { outcome: 'error',   target: null },
      ],
      'wiki:fetch-single-category': [
        { outcome: 'success', target: null },
        { outcome: 'error',   target: null },
      ],
      'wiki:fetch-multiple-categories': [
        { outcome: 'success', target: null },
        { outcome: 'error',   target: null },
      ],
      'wiki:fetch-all-pages': [
        { outcome: 'success', target: null },
        { outcome: 'error',   target: null },
      ],
    },
  },
});

// ── Outer composition DAG ──────────────────────────────────────────────────────

const SCRAPE_OUTPUT_MAPPING: Readonly<Record<string, string>> = { succeeded: 'succeeded', failed: 'failed' };
const RETRY_OUTPUT_MAPPING:  Readonly<Record<string, string>> = { recovered: 'recovered', failedAfterRetry: 'failedAfterRetry' };

/**
 * Outer wiki scrape flow (no discovery phase — titles come from wikiResolveMembersFlow).
 *
 * Operations:
 *   scrape (DeepDAG: wikiScrapePhase) → retry (DeepDAG: wikiRetryPhase) → done
 *
 * All outputs of scrape and retry route uniformly to the next derived stage,
 * matching the previous { success: next, error: next } routing.
 *
 * @category Flows
 * @since 4.0.0
 */
export const wikiScrapeFlow: DAG = FlowDeriver.derive({
  name:       'wikiScrapeDAG',
  version:    '2.0',
  entrypoint: 'scrape',
  contracts: [
    { name: 'scrape',         hardRequired: [],             produces: ['scrape-done'], outputs: ['success', 'error'] },
    { name: 'retry',          hardRequired: ['scrape-done'], produces: ['retry-done'], outputs: ['success', 'error'] },
    { name: 'flow:terminate', hardRequired: ['retry-done'],  produces: [],             outputs: ['success'] },
  ],
  annotations: {
    subDAGs: {
      scrape: { dag: WIKI_SCRAPE_PHASE_FLOW, outputs: ['success', 'error'], stateMapping: { output: SCRAPE_OUTPUT_MAPPING } },
      retry:  { dag: WIKI_RETRY_PHASE_FLOW,  outputs: ['success', 'error'], stateMapping: { output: RETRY_OUTPUT_MAPPING  } },
    },
    terminals: {
      'flow:terminate': [{ outcome: 'success', target: null }],
    },
  },
});
