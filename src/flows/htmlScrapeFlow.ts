/**
 * htmlScrapeFlow — DAGBuilder-backed exports for every built-in HTML DAG.
 *
 * Phase DAGs and outer composition DAGs delegate directly to the `DAGBuilder`
 * factories in `htmlScrapeDag.ts`. The per-page child DAG name for the canonical
 * docs-path is passed to the scatter factories so the phase DAGs can be
 * registered for docs-build visualisation without a real runtime dispatcher.
 *
 * Name constants are re-exported from `htmlScrapeDag.ts` (source of truth)
 * plus the flow-file–specific aliases consumed by tests and `registerAllFlows`.
 *
 * @module flows/htmlScrapeFlow
 * @since 4.0.0
 */

import type { DAGType } from '@studnicky/dagonizer';

import {
  buildHtmlScrapePhaseDag,
  buildHtmlRetryPhaseDag,
  buildHtmlCrawlPhaseDag,
  buildHtmlScrapeDag,
  buildHtmlScrapeDagCrawl,
  HTML_SCRAPE_PHASE,
  HTML_RETRY_PHASE,
  HTML_CRAWL_PHASE,
} from './htmlScrapeDag.js';

import { htmlPageFlowName } from './htmlPageFlow.js';

// ── Name constants ─────────────────────────────────────────────────────────────

/** Canonical name for the HTML initial-scrape phase flow (alias of HTML_SCRAPE_PHASE). */
export const HTML_SCRAPE_PHASE_FLOW: string = HTML_SCRAPE_PHASE;

/** Canonical name for the HTML failure-retry phase flow (alias of HTML_RETRY_PHASE). */
export const HTML_RETRY_PHASE_FLOW: string = HTML_RETRY_PHASE;

/** Canonical name for the HTML URL-discovery phase flow (alias of HTML_CRAWL_PHASE). */
export const HTML_CRAWL_PHASE_FLOW: string = HTML_CRAWL_PHASE;

// ── Docs-path per-page DAG name ────────────────────────────────────────────────
// The canonical representative DAG name used at docs-build time and
// visualisation. At runtime each run builds its own per-target name.

const DOCS_PER_PAGE_DAG_NAME = htmlPageFlowName('canonical');

// ── Phase DAGs ─────────────────────────────────────────────────────────────────

/**
 * HTML URL-discovery phase DAG (docs-path instance).
 *
 * Delegates to `buildHtmlCrawlPhaseDag`. At runtime `runHtml` builds its own
 * instance and registers it on the per-run dispatcher.
 *
 * @category Flows
 * @since 4.0.0
 */
export const htmlCrawlPhaseFlow: DAGType = buildHtmlCrawlPhaseDag();

/**
 * HTML initial-scrape phase DAG (docs-path instance).
 *
 * Delegates to `buildHtmlScrapePhaseDag` with the canonical docs-path per-page
 * DAG name. At runtime `runHtml` builds its own instance with the per-target name.
 *
 * @category Flows
 * @since 4.0.0
 */
export const htmlScrapePhaseFlow: DAGType = buildHtmlScrapePhaseDag(DOCS_PER_PAGE_DAG_NAME);

/**
 * HTML failure-retry phase DAG (docs-path instance).
 *
 * @category Flows
 * @since 4.0.0
 */
export const htmlRetryPhaseFlow: DAGType = buildHtmlRetryPhaseDag(DOCS_PER_PAGE_DAG_NAME);

// ── Outer composition DAGs ─────────────────────────────────────────────────────

/**
 * Outer HTML scrape DAG — no-crawl path (docs-path instance).
 *
 * @category Flows
 * @since 4.0.0
 */
export const htmlScrapeFlow: DAGType = buildHtmlScrapeDag();

/**
 * Outer HTML scrape DAG — crawl path (docs-path instance).
 *
 * @category Flows
 * @since 4.0.0
 */
export const htmlScrapeFlowCrawl: DAGType = buildHtmlScrapeDagCrawl();
