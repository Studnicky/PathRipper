/**
 * registerAllFlows — populates a Dagonizer instance with every built-in DAG
 * this application ships, without executing any of them.
 *
 * Used at docs-build time by `docs/.vitepress/scripts/render-dags.mjs` to
 * enumerate registered DAGs via `dispatcher.listDAGs()` and render each one
 * through `MermaidRenderer.render(dag)`.
 *
 * This module registers only `src/`-level nodes and DAGs. The docs render
 * script additionally registers plugin DAGs from `plugins/` and `examples/`
 * after calling this function.
 *
 * @module flows/registerAllFlows
 * @since 4.0.0
 */

import type { Dagonizer } from '@noocodex/dagonizer';

import type { ScrapeState }    from '../state/ScrapeState.js';
import type { RipperServices } from '../services/RipperServices.js';

// ── Flow DAG exports ───────────────────────────────────────────────────────────
import {
  htmlCrawlPhaseFlow,
  htmlScrapePhaseFlow,
  htmlRetryPhaseFlow,
  htmlScrapeFlow,
  htmlScrapeFlowCrawl,
} from './htmlScrapeFlow.js';
import {
  wikiScrapePhaseFlow,
  wikiRetryPhaseFlow,
  wikiResolveMembersFlow,
  wikiScrapeFlow,
} from './wikiScrapeFlow.js';
import { configLoadFlow }                  from './configLoadFlow.js';
import { buildLinkCrawlFlow } from './linkCrawlFlow.js';
import { cliScrapeFlow }                   from './cliScrapeFlow.js';
import {
  buildHtmlPageFlow,
  htmlPageFlowName,
}                                          from './htmlPageFlow.js';
import {
  buildWikiPageFlow,
  wikiPageFlowName,
}                                          from './wikiPageFlow.js';

// ── Registration-time stubs ────────────────────────────────────────────────────
import { stub } from './stub.js';

// ── Built-in nodes ─────────────────────────────────────────────────────────────
import {
  HtmlFetchNode,
  WikiFetchNode,
  HtmlWriteRawNode,
  WikiWriteRawNode,
  JsonWriteNode,
  JsonlAppendNode,
  ValidateSchemaNode,
  CrawlListTargetsNode,
  TerminalNode,
} from '../nodes/index.js';


// ── Canonical target IDs used for representative per-page DAGs ────────────────

/** Representative target ID for docs-time HTML page DAG. */
const HTML_CANONICAL_TARGET = 'canonical';

/** Representative target ID for docs-time wiki page DAG. */
const WIKI_CANONICAL_TARGET = 'canonical';

/** Representative HTML pipeline for the canonical htmlPageDAG diagram. */
const HTML_CANONICAL_PIPELINE: ReadonlyArray<string> = [
  'html:fetch',
  'html:write-raw',
  'json:write',
];

/** Representative wiki pipeline for the canonical wikiPageDAG diagram. */
const WIKI_CANONICAL_PIPELINE: ReadonlyArray<string> = [
  'wiki:fetch',
  'wiki:write-raw',
  'json:write',
];

// ── DAG name → .mmd filename mapping ──────────────────────────────────────────

/**
 * Maps each registered DAG name to its `.mmd` output filename under
 * `docs/_generated/`. Entries that diverge from `<dagName>.mmd` (plugin DAGs
 * and dynamic per-target DAG names) are listed explicitly.
 *
 * The render script reads this map; DAG names absent from the map fall back to
 * `${dag.name.replace(/:/g, '-').replace(/\//g, '-')}.mmd`.
 */
export const DAG_FILENAME_MAP: ReadonlyMap<string, string> = new Map([
  // Outer flows
  ['htmlScrapeDAG',      'htmlScrapeDAG.mmd'],
  ['htmlScrapeDAGCrawl', 'htmlScrapeDAGCrawl.mmd'],
  ['wikiScrapeDAG',      'wikiScrapeDAG.mmd'],

  // CLI dispatch
  ['cliScrapeDAG',       'cliScrapeDAG.mmd'],

  // HTML phases
  ['htmlCrawlPhase',     'htmlCrawlPhase.mmd'],
  ['htmlScrapePhase',    'htmlScrapePhase.mmd'],
  ['htmlRetryPhase',     'htmlRetryPhase.mmd'],

  // Wiki phases
  ['wikiScrapePhase',    'wikiScrapePhase.mmd'],
  ['wikiRetryPhase',     'wikiRetryPhase.mmd'],

  // Per-page (dynamic name → stable filename)
  [htmlPageFlowName(HTML_CANONICAL_TARGET), 'htmlPageDAG.mmd'],
  [wikiPageFlowName(WIKI_CANONICAL_TARGET), 'wikiPageDAG.mmd'],

  // Config load
  ['configLoadDAG',      'configLoadDAG.mmd'],

  // Link crawler
  ['linkCrawlDAG',      'linkCrawlDAG.mmd'],
  ['linkCrawlLevelDAG', 'linkCrawlLevelDAG.mmd'],

  // Wiki member resolution
  ['wikiResolveMembersDAG', 'wikiResolveMembersDAG.mmd'],

  // Plugin DAGs — DAG name includes ':' which is unsafe in filenames.
  // Maintained here for `render-dags.mjs` to look up after plugin registration.
  ['aonprd:parse',       'aonprdParseDAG.mmd'],
  ['docs:parse',         'docsScraperDAG.mmd'],
  ['wiki-docs:parse',    'wikiDocsDAG.mmd'],
]);

// ── Registration ───────────────────────────────────────────────────────────────

/**
 * Registers every built-in application DAG on `dispatcher` without executing
 * any of them.
 *
 * Registration order: nodes first (dispatcher validates DAG placements against
 * the node registry), then phase DAGs (must precede outer DAGs that reference
 * them as DeepDAGNode), then outer / utility DAGs.
 *
 * Plugin DAGs (`aonprd:parse`, `docs:parse`, `wiki-docs:parse`) are NOT
 * registered here — the docs render script registers them after this call so
 * that plugin imports stay outside the `src/` rootDir constraint.
 *
 * Phase DAGs (`htmlScrapePhaseFlow` etc.) are imported directly from the
 * DAGDeriver-derived flow files. These flows reference virtual fan-out
 * operation names (`scrape-urls`, `html:partition`, etc.) that are not runtime
 * nodes — stubs are registered below so the dispatcher's node-reference
 * validation passes at docs-build time.
 *
 * @param dispatcher - A `Dagonizer<ScrapeState, RipperServices>` instance. The
 *   caller owns construction; this function only calls `registerNode` and
 *   `registerDAG`.
 */
export const registerAllFlows = (
  dispatcher: Dagonizer<ScrapeState, RipperServices>,
): void => {
  // ── Built-in pipeline nodes ────────────────────────────────────────────────
  dispatcher.registerNode(HtmlFetchNode);
  dispatcher.registerNode(WikiFetchNode);
  dispatcher.registerNode(HtmlWriteRawNode);
  dispatcher.registerNode(WikiWriteRawNode);
  dispatcher.registerNode(JsonWriteNode);
  dispatcher.registerNode(JsonlAppendNode);
  dispatcher.registerNode(ValidateSchemaNode);
  dispatcher.registerNode(CrawlListTargetsNode);
  dispatcher.registerNode(TerminalNode);

  // ── Dynamic dispatch wrapper stubs ────────────────────────────────────────
  // Created at run-time by makeDispatchPageDagNode; stubs satisfy the
  // dispatcher's node-reference validation at docs-build time.
  dispatcher.registerNode(stub('html:dispatch-page-dag', ['success', 'error']));
  dispatcher.registerNode(stub('wiki:dispatch-page-dag', ['success', 'error']));

  // ── CLI node stubs ─────────────────────────────────────────────────────────
  // Registered at run-time by cli.ts.
  dispatcher.registerNode(stub('cli:load-config',          ['success', 'error']));
  dispatcher.registerNode(stub('cli:resolve-target',       ['html', 'wiki', 'not-found']));
  dispatcher.registerNode(stub('cli:dispatch-html-scrape', ['success', 'partial', 'error']));
  dispatcher.registerNode(stub('cli:dispatch-wiki-scrape', ['success', 'partial', 'error']));
  dispatcher.registerNode(stub('cli:write-manifest',       ['success', 'skipped']));
  dispatcher.registerNode(stub('cli:exit',                 ['success']));

  // ── Config node stubs ─────────────────────────────────────────────────────
  // Registered at run-time by RipperConfig.ts.
  dispatcher.registerNode(stub('config:read-file',         ['success', 'not-found', 'error']));
  dispatcher.registerNode(stub('config:parse-json',        ['success', 'error']));
  dispatcher.registerNode(stub('config:validate-schema',   ['valid', 'invalid']));
  dispatcher.registerNode(stub('config:normalize-cache',   ['success', 'invariant-violated']));
  dispatcher.registerNode(stub('config:assert-invariants', ['success', 'invariant-violated']));

  // ── Wiki mode-resolution node stubs ───────────────────────────────────────
  // Registered by runWiki before wiki member-resolution dispatch.
  dispatcher.registerNode(stub('wiki:choose-mode',               ['resume-failures', 'single-category', 'by-categories', 'all-pages']));
  dispatcher.registerNode(stub('wiki:resume-failures',           ['success', 'error']));
  dispatcher.registerNode(stub('wiki:fetch-single-category',     ['success', 'error']));
  dispatcher.registerNode(stub('wiki:fetch-multiple-categories', ['success', 'error']));
  dispatcher.registerNode(stub('wiki:fetch-all-pages',           ['success', 'error']));

  // ── Link crawler node stubs ───────────────────────────────────────────────
  // Registered by LinkLister.ts before crawl dispatch.
  dispatcher.registerNode(stub('crawl:init-frontier',       ['ready', 'empty']));
  dispatcher.registerNode(stub('crawl:fetch-and-extract',   ['success', 'empty', 'error', 'permanent']));
  dispatcher.registerNode(stub('crawl:dedupe-and-enqueue',  ['frontier-ready', 'frontier-empty', 'budget-exhausted']));
  dispatcher.registerNode(stub('crawl:exhausted',           ['success']));
  dispatcher.registerNode(stub('crawl:recurse',             ['success']));

  // ── Virtual fan-out node stubs (DAGDeriver phase flows) ─────────────────
  // The DAGDeriver-derived phase flows use virtual operation names that do not
  // correspond to real runtime nodes. These stubs satisfy dispatcher validation
  // at docs-build time so the phase flows can be registered for visualization.
  dispatcher.registerNode(stub('scrape-urls',            ['all-success', 'partial', 'all-error', 'empty']));
  dispatcher.registerNode(stub('html:partition',         ['success']));
  dispatcher.registerNode(stub('html:retryPartition',    ['success']));
  dispatcher.registerNode(stub('retry-urls',             ['all-success', 'partial', 'all-error', 'empty']));
  dispatcher.registerNode(stub('scrape-titles',          ['all-success', 'partial', 'all-error', 'empty']));
  dispatcher.registerNode(stub('wiki:partition',         ['success']));
  dispatcher.registerNode(stub('wiki:retryPartition',    ['success']));
  dispatcher.registerNode(stub('retry-titles',           ['all-success', 'partial', 'all-error', 'empty']));

  // ── Phase DAGs (imported from DAGDeriver flow files) ─────────────────────
  // Defined once in the flow files; no inline DAGBuilder duplication here.
  // Must precede outer DAGs that reference them as DeepDAGNode.
  dispatcher.registerDAG(htmlCrawlPhaseFlow);
  dispatcher.registerDAG(htmlScrapePhaseFlow);
  dispatcher.registerDAG(htmlRetryPhaseFlow);
  dispatcher.registerDAG(wikiScrapePhaseFlow);
  dispatcher.registerDAG(wikiRetryPhaseFlow);

  // ── Per-page child DAGs (representative canonical pipelines) ──────────────
  dispatcher.registerDAG(
    buildHtmlPageFlow(HTML_CANONICAL_PIPELINE, HTML_CANONICAL_TARGET),
  );
  dispatcher.registerDAG(
    buildWikiPageFlow(WIKI_CANONICAL_PIPELINE, WIKI_CANONICAL_TARGET),
  );

  // ── Outer scrape DAGs ─────────────────────────────────────────────────────
  dispatcher.registerDAG(htmlScrapeFlow);
  dispatcher.registerDAG(htmlScrapeFlowCrawl);
  dispatcher.registerDAG(wikiScrapeFlow);

  // ── CLI dispatch DAG ──────────────────────────────────────────────────────
  dispatcher.registerDAG(cliScrapeFlow);

  // ── Utility DAGs ──────────────────────────────────────────────────────────
  dispatcher.registerDAG(configLoadFlow);
  // Level DAG first: outer linkCrawlDAG references it as a DeepDAGNode.
  const { linkCrawlDAG, linkCrawlLevelDAG } = buildLinkCrawlFlow();
  dispatcher.registerDAG(linkCrawlLevelDAG);
  dispatcher.registerDAG(linkCrawlDAG);
  dispatcher.registerDAG(wikiResolveMembersFlow);
};
