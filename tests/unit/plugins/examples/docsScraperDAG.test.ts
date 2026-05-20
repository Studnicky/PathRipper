// Unit tests for the docs-scraper plugin's wrapper DAG (Flavor 2 universal pattern).
// Verifies that the 1-node DAG `docs:parse` dispatches the inner `docs:parse-impl`
// node correctly when invoked through the dispatcher.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Dagonizer } from '@noocodex/dagonizer';

import { ScrapeState } from '../../../../src/state/ScrapeState.js';
import { docsParseNode, docsParseFlow as docsParseDAG } from '../../../../examples/docs-scraper/plugin.js';

const FIXTURE_HTML = `
<html>
  <body>
    <h1>Architecture</h1>
    <section data-component="pipeline">
      <h2>Pipeline</h2>
      <p class="summary">Orchestrates the per-page DAG dispatch.</p>
    </section>
    <section data-component="orchestrator">
      <h2>Orchestrator</h2>
      <p class="summary">Coordinates HTML and Wiki scrape flows.</p>
    </section>
  </body>
</html>
`;

function makeState(html: string, url: string): ScrapeState {
  const state = new ScrapeState();
  state.page = { targetId: 'docs', title: '', url, html };
  return state;
}

describe('docs-scraper wrapper DAG (Flavor 2 universal)', () => {
  it('DAG name matches the pipeline-config step name docs:parse', () => {
    assert.equal(docsParseDAG.name, 'docs:parse');
  });

  it('inner NodeInterface is renamed to docs:parse-impl', () => {
    assert.equal(docsParseNode.name, 'docs:parse-impl');
  });

  it('DAG has exactly one node placement', () => {
    assert.equal(docsParseDAG.nodes.length, 1);
    assert.equal(docsParseDAG.nodes[0]?.['@type'], 'SingleNode');
  });

  it('dispatching docs:parse extracts data-component sections', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dispatcher = new Dagonizer<ScrapeState, any>({ services: {} as any });
    dispatcher.registerNode(docsParseNode);
    dispatcher.registerDAG(docsParseDAG);

    const state = makeState(FIXTURE_HTML, 'http://test.local/architecture.html');
    await dispatcher.execute('docs:parse', state);

    assert.ok(state.output !== null, 'state.output should be populated by the DAG');
    assert.equal(state.output?.['_type'], 'docs_section');
    assert.equal(state.output?.['component'], 'pipeline');
  });

  it('dispatching docs:parse on a page without sections falls back to docs_page', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dispatcher = new Dagonizer<ScrapeState, any>({ services: {} as any });
    dispatcher.registerNode(docsParseNode);
    dispatcher.registerDAG(docsParseDAG);

    const state = makeState('<html><body><h1>Plain Page</h1></body></html>', 'http://test.local/plain.html');
    await dispatcher.execute('docs:parse', state);

    assert.equal(state.output?.['_type'], 'docs_page');
    assert.equal(state.output?.['title'], 'Plain Page');
  });
});
