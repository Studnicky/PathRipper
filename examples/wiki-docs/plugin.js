// wiki-docs plugin — registered as `wiki-docs:parse`
// Extracts structured data from wikitext pages that use the {{RipperoniComponent}} infobox template.
// Designed to work against the wiki fixture server in tests/e2e/fixtures/wiki/ and any
// real MediaWiki instance that uses the same template.
//
// Plugin contract: exports `register(dispatcher)` which is called by `RipperRun`
// after importing this module. No side-effect-on-import registration.
import wtf from 'wtf_wikipedia';
import { DAGDeriver } from '@noocodex/dagonizer/derive';
const TEMPLATE_MARKER = '{{RipperoniComponent';
export const wikiDocsParseNode = {
    name: 'wiki-docs:parse-impl',
    outputs: ['success'],
    async execute(state, _context) {
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
                    return { output: 'success' };
                }
            }
        }
        // No recognized template — return raw page output.
        const fallback = { _type: 'raw_page', title, wikitext };
        state.output = fallback;
        return { output: 'success' };
    },
};
/**
 * Contract-derived wiki-docs parse DAG.
 *
 * @category Flows
 * @since 4.0.0
 */
export const wikiDocsParseFlow = DAGDeriver.derive({
    name: 'wiki-docs:parse',
    version: '2.0',
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
export const wikiDocsParseContract = {
    name: 'wiki-docs:parse-impl',
    hardRequired: ['page.wikitext'],
    produces: ['output'],
    outputs: ['success'],
};
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
