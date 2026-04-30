// docs-scraper plugin — registered as `docs:parse`
// Extracts structured data from HTML pages that have `section[data-component]` markup,
// as used in the Ripperoni architecture docs at https://studnicky.github.io/PathRipper/
//
// Self-registers on import so the TaskRegistry can find it by name.
import { load } from 'cheerio';
import { TaskRegistry } from '../../src/registry/TaskRegistry.js';
TaskRegistry.register('docs:parse', async (next, state) => {
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
        // Store all sections on the state for the e2e test to inspect
        state['sections'] = results;
    }
    else {
        const pageTitle = $('h1').first().text().trim();
        const output = { _type: 'docs_page', url, title: pageTitle };
        state.output = output;
    }
    await next();
});
