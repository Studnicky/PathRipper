// wiki-docs plugin — registered as `wiki-docs:parse`
// Extracts structured data from wikitext pages that use the {{RipperoniComponent}} infobox template.
// Designed to work against the wiki fixture server in tests/e2e/fixtures/wiki/ and any
// real MediaWiki instance that uses the same template.
//
// Plugin contract: exports `register(dispatcher)` which is called by `RipperRun`
// after importing this module. No side-effect-on-import registration.

import wtf from 'wtf_wikipedia';

import { DAGBuilder, ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, DAGType } from '@studnicky/dagonizer';

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

class WikiDocsParseNodeImpl extends ScalarNode<ScrapeState, 'success', RipperServices> {
  public readonly name    = 'wiki-docs:parse-impl';
  public readonly outputs = ['success'] as const;

  protected override async executeOne(
    state:    ScrapeState,
    _context: NodeContextType<RipperServices>,
  ): Promise<NodeOutputType<'success'>> {
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
          return NodeOutputBuilder.of('success');
        }
      }
    }

    // No recognized template — return raw page output.
    const fallback: RawPageOutput = { _type: 'raw_page', title, wikitext };
    state.output = fallback as unknown as Record<string, unknown>;
    return NodeOutputBuilder.of('success');
  }
}

export const wikiDocsParseNode = new WikiDocsParseNodeImpl();

/**
 * Contract-derived wiki-docs parse DAG.
 *
 * @category Flows
 * @since 4.0.0
 */
export const wikiDocsParseFlow: DAGType = new DAGBuilder('wiki-docs:parse', '2.0')
  .entrypoint('wiki-docs:parse-impl')
  .node('wiki-docs:parse-impl', wikiDocsParseNode, { success: 'wiki-docs:parse:done' })
  .terminal('wiki-docs:parse:done', { outcome: 'completed' })
  .build();

// ── Plugin contract ────────────────────────────────────────────────────────────

/**
 * Explicit plugin registration. Called by `RipperRun` after importing this module.
 *
 * @param dispatcher - The `RipperDagonizer` instance for the current scrape run.
 */
export function register(dispatcher: RipperDagonizer<ScrapeState>): void {
  dispatcher.registerNode(wikiDocsParseNode);
  dispatcher.registerDAG(wikiDocsParseFlow);
}
