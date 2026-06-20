// docs-scraper plugin — registered as `docs:parse`
// Extracts structured data from HTML pages that have `section[data-component]` markup,
// as used in the Ripperoni architecture docs at https://studnicky.github.io/PathRipper/
//
// Plugin contract: exports `register(dispatcher)` which is called by `RipperRun`
// after importing this module. No side-effect-on-import registration.

import { load } from 'cheerio';

import { DAGBuilder, ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, DAGType } from '@studnicky/dagonizer';
import type { OperationContractFragmentType }           from '@studnicky/dagonizer/contracts';

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

class DocsParseNodeImpl extends ScalarNode<ScrapeState, 'success', RipperServices> {
  public readonly name    = 'docs:parse-impl';
  public readonly outputs = ['success'] as const;
  public override readonly contract: OperationContractFragmentType = {
    hardRequired: ['page.html'],
    produces:     [] as const,
  };

  protected override async executeOne(
    state:    ScrapeState,
    _context: NodeContextType<RipperServices>,
  ): Promise<NodeOutputType<'success'>> {
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

    return NodeOutputBuilder.of('success');
  }
}

export const docsParseNode = new DocsParseNodeImpl();

/**
 * Contract-derived docs parse DAG.
 *
 * @category Flows
 * @since 4.0.0
 */
export const docsParseFlow: DAGType = new DAGBuilder('docs:parse', '2.0')
  .entrypoint('docs:parse-impl')
  .node('docs:parse-impl', docsParseNode, { success: 'docs:parse:done' })
  .terminal('docs:parse:done', { outcome: 'completed' })
  .build();

// ── Plugin contract ────────────────────────────────────────────────────────────

/**
 * Explicit plugin registration. Called by `RipperRun` after importing this module.
 *
 * @param dispatcher - The `RipperDagonizer` instance for the current scrape run.
 */
export function register(dispatcher: RipperDagonizer<ScrapeState>): void {
  dispatcher.registerNode(docsParseNode);
  dispatcher.registerDAG(docsParseFlow);
}
