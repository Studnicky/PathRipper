// docs-scraper plugin — registered as `docs:parse`
// Extracts structured data from HTML pages that have `section[data-component]` markup,
// as used in the Ripperoni architecture docs at https://studnicky.github.io/PathRipper/
//
// Self-registers on import so the TaskRegistry can find it by name.

import { load } from 'cheerio';

import { TaskRegistry } from '../../src/registry/TaskRegistry.js';
import type { PipelineStateInterface } from '../../src/types/PipelineState.js';
import type { NextFnInterface } from '../../src/types/Pipeline.js';

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

TaskRegistry.register('docs:parse', async (next: NextFnInterface, state: PipelineStateInterface): Promise<void> => {
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
    // Store all sections on the state for the e2e test to inspect
    (state as Record<string, unknown>)['sections'] = results;
  } else {
    const pageTitle = $('h1').first().text().trim();
    const output: DocsPageOutput = { _type: 'docs_page', url, title: pageTitle };
    state.output = output as unknown as Record<string, unknown>;
  }

  await next();
});
