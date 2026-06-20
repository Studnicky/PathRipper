/**
 * wikiScrapeFlow — DAGBuilder-backed exports for every built-in wiki DAG.
 *
 * Phase DAGs and the outer composition DAG delegate directly to the
 * `DAGBuilder` factories in `wikiScrapeDag.ts`. The docs-path phase DAGs
 * are built with the canonical docs per-page DAG name so they can be
 * registered for visualisation without a real runtime dispatcher.
 *
 * `wikiResolveMembersFlow` is constructed here via `DAGBuilder` using the real
 * wiki-node singletons so it remains independently dispatchable at runtime
 * (imported by `runWiki.ts` and the unit-test suite).
 *
 * Name constants are re-exported from `wikiScrapeDag.ts` (source of truth)
 * plus the flow-file–specific aliases consumed by tests and `registerAllFlows`.
 *
 * @module flows/wikiScrapeFlow
 * @since 4.0.0
 */

import { DAGBuilder } from '@studnicky/dagonizer';
import type { DAGType } from '@studnicky/dagonizer';

import {
  buildWikiScrapePhaseDag,
  buildWikiRetryPhaseDag,
  buildWikiScrapeDag,
  WIKI_SCRAPE_PHASE,
  WIKI_RETRY_PHASE,
} from './wikiScrapeDag.js';

import { wikiPageFlowName }               from './wikiPageFlow.js';
import { ChooseModeNode }                 from '../nodes/wiki/ChooseModeNode.js';
import { ResumeFailuresNode }             from '../nodes/wiki/ResumeFailuresNode.js';
import { FetchSingleCategoryNode }        from '../nodes/wiki/FetchSingleCategoryNode.js';
import { FetchMultipleCategoriesNode }    from '../nodes/wiki/FetchMultipleCategoriesNode.js';
import { FetchAllPagesNode }              from '../nodes/wiki/FetchAllPagesNode.js';

// ── Name constants ─────────────────────────────────────────────────────────────

/** Canonical name for the wiki initial-scrape phase flow (alias of WIKI_SCRAPE_PHASE). */
export const WIKI_SCRAPE_PHASE_FLOW: string = WIKI_SCRAPE_PHASE;

/** Canonical name for the wiki failure-retry phase flow (alias of WIKI_RETRY_PHASE). */
export const WIKI_RETRY_PHASE_FLOW: string = WIKI_RETRY_PHASE;

/** Canonical name for the wiki member-resolution flow. */
export const WIKI_RESOLVE_MEMBERS_FLOW = 'wikiResolveMembersDAG';

// ── Docs-path per-page DAG name ────────────────────────────────────────────────
// Phase DAGs built for docs/visualisation reference the canonical docs per-page
// DAG name. At docs-build time registerAllFlows also registers a
// buildWikiPageFlow instance under this same name.

const DOCS_PER_PAGE_DAG_NAME = wikiPageFlowName('canonical');

// ── Phase DAGs ─────────────────────────────────────────────────────────────────

/**
 * Wiki initial-scrape phase DAG (docs-path instance).
 *
 * Built with the canonical docs per-page DAG name. At docs-build time the
 * per-page DAG is registered via `registerAllFlows`; at runtime `runWiki`
 * builds its own phase DAGs with the target-specific per-page DAG name.
 *
 * @category Flows
 * @since 4.0.0
 */
export const wikiScrapePhaseFlow: DAGType = buildWikiScrapePhaseDag(DOCS_PER_PAGE_DAG_NAME);

/**
 * Wiki failure-retry phase DAG (docs-path instance).
 *
 * @category Flows
 * @since 4.0.0
 */
export const wikiRetryPhaseFlow: DAGType = buildWikiRetryPhaseDag(DOCS_PER_PAGE_DAG_NAME);

// ── Member-resolution flow ─────────────────────────────────────────────────────

/**
 * Wiki member-resolution DAG.
 *
 * Shape:
 *   wiki:choose-mode → {
 *     resume-failures:  wiki:resume-failures           → completed / failed
 *     single-category:  wiki:fetch-single-category     → completed / failed
 *     by-categories:    wiki:fetch-multiple-categories → completed / failed
 *     all-pages:        wiki:fetch-all-pages            → completed / failed
 *   }
 *
 * Routing is explicit, so the member-resolution nodes carry no contract (they
 * inherit `EMPTY_CONTRACT_FRAGMENT`) and `DAGBuilder.build()` places the real
 * implementations directly.
 *
 * @category Flows
 * @since 4.0.0
 */
export const wikiResolveMembersFlow: DAGType = new DAGBuilder(WIKI_RESOLVE_MEMBERS_FLOW, '2.0')
  .node('wiki:choose-mode', ChooseModeNode, {
    'resume-failures':  'wiki:resume-failures',
    'single-category':  'wiki:fetch-single-category',
    'by-categories':    'wiki:fetch-multiple-categories',
    'all-pages':        'wiki:fetch-all-pages',
  })
  .node('wiki:resume-failures', ResumeFailuresNode, {
    success: 'resolve-done',
    error:   'resolve-failed',
  })
  .node('wiki:fetch-single-category', FetchSingleCategoryNode, {
    success: 'resolve-done',
    error:   'resolve-failed',
  })
  .node('wiki:fetch-multiple-categories', FetchMultipleCategoriesNode, {
    success: 'resolve-done',
    error:   'resolve-failed',
  })
  .node('wiki:fetch-all-pages', FetchAllPagesNode, {
    success: 'resolve-done',
    error:   'resolve-failed',
  })
  .terminal('resolve-done',   { outcome: 'completed' })
  .terminal('resolve-failed', { outcome: 'failed'    })
  .build();

// ── Outer composition DAG ──────────────────────────────────────────────────────

/**
 * Outer wiki scrape DAG (docs-path instance).
 *
 * Delegates to `buildWikiScrapeDag`. At runtime `runWiki` builds its own
 * instance after the phase DAGs are registered on the batch dispatcher.
 *
 * @category Flows
 * @since 4.0.0
 */
export const wikiScrapeFlow: DAGType = buildWikiScrapeDag();
