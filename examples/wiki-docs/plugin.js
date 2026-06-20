// wiki-docs plugin — registered as `wiki-docs:parse`
// Extracts structured data from wikitext pages that use the {{RipperoniComponent}} infobox template.
// Designed to work against the wiki fixture server in tests/e2e/fixtures/wiki/ and any
// real MediaWiki instance that uses the same template.
//
// Plugin contract: exports `register(dispatcher)` which is called by `RipperRun`
// after importing this module. No side-effect-on-import registration.
import wtf from 'wtf_wikipedia';
import { DAGBuilder, ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
const TEMPLATE_MARKER = '{{RipperoniComponent';
class WikiDocsParseNodeImpl extends ScalarNode {
    name = 'wiki-docs:parse-impl';
    outputs = ['success'];
    async executeOne(state, _context) {
        const wikitext = state.page.wikitext ?? '';
        const title = state.page.title;
        if (wikitext.includes(TEMPLATE_MARKER)) {
            const doc = wtf(wikitext);
            const templates = doc.templates();
            for (const template of templates) {
                const data = template.json();
                if (data['template'] === 'ripperonicomponent') {
                    const output = {
                        _type: 'ripperoni_component',
                        name: data['name'] ?? title,
                        kind: data['kind'] ?? '',
                        since: data['since'] ?? '',
                        description: data['description'] ?? '',
                        source: data['source'] ?? '',
                    };
                    state.output = output;
                    return NodeOutputBuilder.of('success');
                }
            }
        }
        // No recognized template — return raw page output.
        const fallback = { _type: 'raw_page', title, wikitext };
        state.output = fallback;
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
export const wikiDocsParseFlow = new DAGBuilder('wiki-docs:parse', '2.0')
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
export function register(dispatcher) {
    dispatcher.registerNode(wikiDocsParseNode);
    dispatcher.registerDAG(wikiDocsParseFlow);
}
