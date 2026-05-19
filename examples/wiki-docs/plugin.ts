// wiki-docs plugin — registered as `wiki-docs:parse`
// Extracts structured data from wikitext pages that use the {{RipperoniComponent}} infobox template.
// Designed to work against the wiki fixture server in tests/e2e/fixtures/wiki/ and any
// real MediaWiki instance that uses the same template.
//
// Plugin contract: exports `register(dispatcher)` which is called by `RipperRun`
// after importing this module. No side-effect-on-import registration.

import wtf from 'wtf_wikipedia';

import { DAGBuilder } from '@noocodex/dagonizer/builder';
import { FlowDeriver } from '@noocodex/dagonizer/derive';
import type { NodeInterface, NodeContextInterface, DAG } from '@noocodex/dagonizer';
import type { OperationContract } from '@noocodex/dagonizer/contracts';

import type { RipperDagonizer } from '../../src/dispatcher/RipperDagonizer.js';
import type { ScrapeState }     from '../../src/state/ScrapeState.js';
import type { RipperServices }  from '../../src/services/RipperServices.js';

const TEMPLATE_MARKER = '{{RipperoniComponent';

interface RipperoniComponentOutput {
  readonly _type: 'ripperoni_component';
  readonly name: string;
  readonly kind: string;
  readonly since: string;
  readonly description: string;
  readonly source: string;
}

interface RawPageOutput {
  readonly _type: 'raw_page';
  readonly title: string;
  readonly wikitext: string;
}

export const wikiDocsParseNode: NodeInterface<ScrapeState, 'success', RipperServices> = {
  name:    'wiki-docs:parse-impl',
  outputs: ['success'],

  async execute(
    state:   ScrapeState,
    _context: NodeContextInterface<RipperServices>,
  ): Promise<{ output: 'success' }> {
    const wikitext = state.page.wikitext ?? '';
    const title    = state.page.title;

    if (wikitext.includes(TEMPLATE_MARKER)) {
      const doc       = wtf(wikitext);
      const templates = doc.templates();

      for (const template of templates) {
        const data = template.json() as Record<string, string>;
        if (data['template'] === 'ripperonicomponent') {
          const output: RipperoniComponentOutput = {
            _type:       'ripperoni_component',
            name:        data['name']        ?? title,
            kind:        data['kind']        ?? '',
            since:       data['since']       ?? '',
            description: data['description'] ?? '',
            source:      data['source']      ?? '',
          };
          state.output = output as unknown as Record<string, unknown>;
          return { output: 'success' };
        }
      }
    }

    // No recognized template — return raw page output.
    const fallback: RawPageOutput = { _type: 'raw_page', title, wikitext };
    state.output = fallback as unknown as Record<string, unknown>;
    return { output: 'success' };
  },
};

/**
 * Flavor 2 (universal) wrapper DAG: trivial plugins are 1-node DAGs.
 * Legacy DAGBuilder version — kept for backwards compat during Wave 1.
 */
export const wikiDocsParseDAG: DAG = new DAGBuilder('wiki-docs:parse', '1.0')
  .node('parse', wikiDocsParseNode, { success: null })
  .build();

/**
 * FlowDeriver version of the wiki-docs parse DAG.
 *
 * @category Flows
 * @since 4.0.0
 */
export const wikiDocsParseFlow: DAG = FlowDeriver.derive({
  name:       'wiki-docs:parse',
  version:    '2.0',
  entrypoint: 'wiki-docs:parse-impl',
  contracts: [
    { name: 'wiki-docs:parse-impl', hardRequired: ['page.wikitext'], produces: ['output'], outputs: ['success'] },
  ],
  annotations: {
    terminals: {
      'wiki-docs:parse-impl': [{ outcome: 'success', target: null }],
    },
  },
});

/** OperationContract for wikiDocsParseNode: reads page.wikitext, produces output. */
export const wikiDocsParseContract: OperationContract = {
  name:         'wiki-docs:parse-impl',
  hardRequired: ['page.wikitext'],
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
  dispatcher.registerNode(wikiDocsParseNode);
  dispatcher.registerDAG(wikiDocsParseDAG);
}
