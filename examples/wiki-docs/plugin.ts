// wiki-docs plugin — registered as `wiki-docs:parse`
// Extracts structured data from wikitext pages that use the {{RipperoniComponent}} infobox template.
// Designed to work against the wiki fixture server in tests/e2e/fixtures/wiki/ and any
// real MediaWiki instance that uses the same template.
//
// Self-registers on import so the TaskRegistry can find it by name.

import wtf from 'wtf_wikipedia';

import { TaskRegistry } from '../../src/registry/TaskRegistry.js';
import type { PipelineStateInterface } from '../../src/types/PipelineState.js';
import type { NextFnInterface } from '../../src/types/Pipeline.js';

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

TaskRegistry.register('wiki-docs:parse', async (next: NextFnInterface, state: PipelineStateInterface): Promise<void> => {
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
        await next();
        return;
      }
    }
  }

  // No recognized template — return raw page output
  const fallback: RawPageOutput = { _type: 'raw_page', title, wikitext };
  state.output = fallback as unknown as Record<string, unknown>;
  await next();
});
