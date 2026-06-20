// docs-scraper plugin — registered as `docs:parse`
// Extracts structured data from HTML pages that have `section[data-component]` markup,
// as used in the Ripperoni architecture docs at https://studnicky.github.io/PathRipper/
//
// Plugin contract: exports `register(dispatcher)` which is called by `RipperRun`
// after importing this module. No side-effect-on-import registration.
import { load } from 'cheerio';
import { DAGBuilder, ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
class DocsParseNodeImpl extends ScalarNode {
    name = 'docs:parse-impl';
    outputs = ['success'];
    contract = {
        hardRequired: ['page.html'],
        produces: [],
    };
    async executeOne(state, _context) {
        const html = state.page.html ?? '';
        const url = state.page.url;
        const $ = load(html);
        const results = [];
        $('section[data-component]').each((_i, el) => {
            const section = $(el);
            const component = section.attr('data-component') ?? '';
            const title = section.find('h2').first().text().trim();
            const summary = section.find('p.summary').first().text().trim();
            if (component.length > 0) {
                results.push({ _type: 'docs_section', component, title, description: summary, url });
            }
        });
        if (results.length > 0) {
            state.output = results[0];
            // Store all sections on state metadata for the e2e test to inspect.
            state.setMetadata('sections', results);
        }
        else {
            const pageTitle = $('h1').first().text().trim();
            const output = { _type: 'docs_page', url, title: pageTitle };
            state.output = output;
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
export const docsParseFlow = new DAGBuilder('docs:parse', '2.0')
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
export function register(dispatcher) {
    dispatcher.registerNode(docsParseNode);
    dispatcher.registerDAG(docsParseFlow);
}
