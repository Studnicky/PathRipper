// docs-scraper plugin — registered as `docs:parse`
// Extracts structured data from HTML pages that have `section[data-component]` markup,
// as used in the Ripperoni architecture docs at https://studnicky.github.io/PathRipper/
//
// Plugin contract: exports `register(dispatcher)` which is called by `RipperRun`
// after importing this module. No side-effect-on-import registration.

import { load } from 'cheerio';

import { DAGBuilder } from '@noocodex/dagonizer/builder';
import { FlowDeriver } from '@noocodex/dagonizer/derive';
import type { NodeInterface, NodeContextInterface, DAG } from '@noocodex/dagonizer';
import type { OperationContract } from '@noocodex/dagonizer/contracts';

import type { RipperDagonizer } from '../../src/dispatcher/RipperDagonizer.js';
import type { ScrapeState }     from '../../src/state/ScrapeState.js';
import type { RipperServices }  from '../../src/services/RipperServices.js';

interface DocsSectionOutput {
  readonly _type: 'docs_section';
  readonly component: string;
  readonly title: string;
  readonly description: string;
  readonly url: string;
}

interface DocsPageOutput {
  readonly _type: 'docs_page';
  readonly url: string;
  readonly title: string;
}

type DocsOutput = DocsSectionOutput | DocsPageOutput;

export const docsParseNode: NodeInterface<ScrapeState, 'success', RipperServices> = {
  name:    'docs:parse-impl',
  outputs: ['success'],

  async execute(
    state:   ScrapeState,
    _context: NodeContextInterface<RipperServices>,
  ): Promise<{ output: 'success' }> {
    const html = state.page.html ?? '';
    const url  = state.page.url;
    const $    = load(html);

    const results: DocsOutput[] = [];

    $('section[data-component]').each((_i: number, el: unknown) => {
      const section   = $(el as Parameters<typeof $>[0]);
      const component = section.attr('data-component') ?? '';
      const title     = section.find('h2').first().text().trim();
      const summary   = section.find('p.summary').first().text().trim();

      if (component.length > 0) {
        results.push({ _type: 'docs_section', component, title, description: summary, url });
      }
    });

    if (results.length > 0) {
      state.output = results[0] as unknown as Record<string, unknown>;
      // Store all sections on state metadata for the e2e test to inspect.
      state.setMetadata('sections', results);
    } else {
      const pageTitle = $('h1').first().text().trim();
      const output: DocsPageOutput = { _type: 'docs_page', url, title: pageTitle };
      state.output = output as unknown as Record<string, unknown>;
    }

    return { output: 'success' };
  },
};

/**
 * Flavor 2 (universal) wrapper DAG: even trivial single-node plugins are
 * registered as DAGs so the orchestrator's resolution layer is uniform.
 * Legacy DAGBuilder version — kept for backwards compat during Wave 1.
 */
export const docsParseDAG: DAG = new DAGBuilder('docs:parse', '1.0')
  .node('parse', docsParseNode, { success: null })
  .build();

/**
 * FlowDeriver version of the docs parse DAG.
 * Name matches `docsParseDAG` so the dispatcher treats them as equivalent.
 *
 * @category Flows
 * @since 4.0.0
 */
export const docsParseFlow: DAG = FlowDeriver.derive({
  name:       'docs:parse',
  version:    '2.0',
  entrypoint: 'docs:parse-impl',
  contracts: [
    { name: 'docs:parse-impl', hardRequired: ['page.html'], produces: ['output'], outputs: ['success'] },
  ],
  annotations: {
    terminals: {
      'docs:parse-impl': [{ outcome: 'success', target: null }],
    },
  },
});

/** OperationContract for docsParseNode: reads page.html, produces output. */
export const docsParseContract: OperationContract = {
  name:         'docs:parse-impl',
  hardRequired: ['page.html'],
  produces:     ['output'],
  outputs:      ['success'],
};

// ── Plugin contract ────────────────────────────────────────────────────────────

/**
 * Explicit plugin registration. Called by `RipperRun` after importing this module.
 *
 * @param dispatcher - The `RipperDagonizer` instance for the current scrape run.
 */
export function register(dispatcher: RipperDagonizer<ScrapeState>): void {
  dispatcher.registerNode(docsParseNode);
  dispatcher.registerDAG(docsParseDAG);
}
