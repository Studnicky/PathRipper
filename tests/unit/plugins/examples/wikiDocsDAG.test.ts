// Unit tests for the wiki-docs plugin's wrapper DAG (Flavor 2 universal pattern).
// Verifies that the 1-node DAG `wiki-docs:parse` dispatches the inner
// `wiki-docs:parse-impl` node correctly when invoked through the dispatcher.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Dagonizer } from '@studnicky/dagonizer';

import { ScrapeState } from '../../../../src/state/ScrapeState.js';
import { wikiDocsParseNode, wikiDocsParseFlow as wikiDocsParseDAG } from '../../../../examples/wiki-docs/plugin.js';

const COMPONENT_WIKITEXT = `
{{RipperoniComponent
|name=HtmlScraper
|kind=class
|since=2.0.0
|description=Fetches HTML pages with retry and rate limiting.
|source=src/scrapers/HtmlScraper.ts
}}
== Description ==
The HtmlScraper handles HTTP requests for HTML targets.
`;

const PLAIN_WIKITEXT = `
== Overview ==
A page without any RipperoniComponent template.
`;

function makeState(wikitext: string, title: string): ScrapeState {
  const state = new ScrapeState();
  state.page = { targetId: 'wiki-docs', title, url: '', wikitext };
  return state;
}

describe('wiki-docs wrapper DAG (Flavor 2 universal)', () => {
  it('DAG name matches the pipeline-config step name wiki-docs:parse', () => {
    assert.equal(wikiDocsParseDAG.name, 'wiki-docs:parse');
  });

  it('inner NodeInterface is renamed to wiki-docs:parse-impl', () => {
    assert.equal(wikiDocsParseNode.name, 'wiki-docs:parse-impl');
  });

  it('DAG has exactly one SingleNode placement and one TerminalNode', () => {
    assert.equal(wikiDocsParseDAG.nodes.length, 2);
    assert.equal(wikiDocsParseDAG.nodes[0]?.['@type'], 'SingleNode');
    assert.equal(wikiDocsParseDAG.nodes[1]?.['@type'], 'TerminalNode');
  });

  it('dispatching wiki-docs:parse parses the RipperoniComponent template', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dispatcher = new Dagonizer<ScrapeState, any>({ services: {} as any });
    dispatcher.registerNode(wikiDocsParseNode);
    dispatcher.registerDAG(wikiDocsParseDAG);

    const state = makeState(COMPONENT_WIKITEXT, 'HtmlScraper');
    await dispatcher.execute('wiki-docs:parse', state);

    assert.ok(state.output !== null, 'state.output should be populated by the DAG');
    assert.equal(state.output?.['_type'], 'ripperoni_component');
    assert.equal(state.output?.['name'], 'HtmlScraper');
    assert.equal(state.output?.['kind'], 'class');
  });

  it('dispatching wiki-docs:parse on a non-component page falls back to raw_page', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dispatcher = new Dagonizer<ScrapeState, any>({ services: {} as any });
    dispatcher.registerNode(wikiDocsParseNode);
    dispatcher.registerDAG(wikiDocsParseDAG);

    const state = makeState(PLAIN_WIKITEXT, 'Plain Page');
    await dispatcher.execute('wiki-docs:parse', state);

    assert.equal(state.output?.['_type'], 'raw_page');
    assert.equal(state.output?.['title'], 'Plain Page');
  });
});
