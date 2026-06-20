/**
 * htmlScrapeFlow — DAGBuilder-backed exports for every built-in HTML DAG.
 *
 * Phase DAGs and outer composition DAGs delegate directly to the `DAGBuilder`
 * factories in `htmlScrapeDag.ts`. A minimal docs-path dispatch node
 * (returning `success` immediately, inheriting `EMPTY_CONTRACT_FRAGMENT`) is
 * passed to the scatter factories so the phase DAGs can be registered for
 * docs-build visualisation without a real runtime dispatcher.
 *
 * Name constants are re-exported from `htmlScrapeDag.ts` (source of truth)
 * plus the flow-file–specific aliases consumed by tests and `registerAllFlows`.
 *
 * @module flows/htmlScrapeFlow
 * @since 4.0.0
 */

import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { DAGType, NodeContextType, NodeOutputType } from '@studnicky/dagonizer';

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

import type { ScrapeState }    from '../state/ScrapeState.js';
import type { RipperServices } from '../services/RipperServices.js';

// ── Name constants ─────────────────────────────────────────────────────────────

/** Canonical name for the HTML initial-scrape phase flow (alias of HTML_SCRAPE_PHASE). */
export const HTML_SCRAPE_PHASE_FLOW: string = HTML_SCRAPE_PHASE;

/** Canonical name for the HTML failure-retry phase flow (alias of HTML_RETRY_PHASE). */
export const HTML_RETRY_PHASE_FLOW: string = HTML_RETRY_PHASE;

/** Canonical name for the HTML URL-discovery phase flow (alias of HTML_CRAWL_PHASE). */
export const HTML_CRAWL_PHASE_FLOW: string = HTML_CRAWL_PHASE;

// ── Docs-path dispatch node ────────────────────────────────────────────────────
// A minimal ScalarNode that satisfies the DAGBuilder scatter factories for
// docs-build and visualisation. EMPTY_CONTRACT_FRAGMENT is inherited (no
// contract override). executeOne is never reached at docs-build time.

class HtmlDocsDispatchNode extends ScalarNode<ScrapeState, string, RipperServices> {
  public readonly name    = 'html:dispatch-page-dag';
  public readonly outputs = ['success', 'error'] as const;

  protected override async executeOne(
    _state:   ScrapeState,
    _context: NodeContextType<RipperServices>,
  ): Promise<NodeOutputType<string>> {
    return NodeOutputBuilder.of('success');
  }
}

const htmlDocsDispatchNode = new HtmlDocsDispatchNode();

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
 * Delegates to `buildHtmlScrapePhaseDag` with a minimal docs-path dispatch
 * node. At docs-build time the node is registered via the stub already present
 * in `registerAllFlows`; at runtime `runHtml` builds its own instance with the
 * real `makeDispatchPageDagNode`.
 *
 * @category Flows
 * @since 4.0.0
 */
export const htmlScrapePhaseFlow: DAGType = buildHtmlScrapePhaseDag(htmlDocsDispatchNode);

/**
 * HTML failure-retry phase DAG (docs-path instance).
 *
 * @category Flows
 * @since 4.0.0
 */
export const htmlRetryPhaseFlow: DAGType = buildHtmlRetryPhaseDag(htmlDocsDispatchNode);

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
