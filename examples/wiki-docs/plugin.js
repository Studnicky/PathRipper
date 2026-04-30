// wiki-docs plugin — registered as `wiki-docs:parse`
// Extracts structured data from wikitext pages that use the {{RipperoniComponent}} infobox template.
// Designed to work against the wiki fixture server in tests/e2e/fixtures/wiki/ and any
// real MediaWiki instance that uses the same template.
//
// Self-registers on import so the TaskRegistry can find it by name.
import wtf from 'wtf_wikipedia';
import { TaskRegistry } from '../../src/registry/TaskRegistry.js';
const TEMPLATE_MARKER = '{{RipperoniComponent';
TaskRegistry.register('wiki-docs:parse', async (next, state) => {
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
                await next();
                return;
            }
        }
    }
    // No recognized template — return raw page output
    const fallback = { _type: 'raw_page', title, wikitext };
    state.output = fallback;
    await next();
});
