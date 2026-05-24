// wiki-docs e2e test — MediaWiki scraper against the local fixture server.
// Uses no external network; the fixture server serves pre-built JSON from
// tests/e2e/fixtures/wiki/data/
//
// Run locally:
//   npm run test:e2e -- --test-name-pattern='wiki-docs'

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MediaWikiScraper }   from '../../src/scrapers/MediaWikiScraper.js';
import { ScrapeState }        from '../../src/state/ScrapeState.js';
import type { RipperServices } from '../../src/services/RipperServices.js';
import { Logger }              from '../../src/modules/logger/logger.js';
import type { WikiFixtureServerInterface } from './fixtures/wiki/server.js';
import { startWikiFixtureServer } from './fixtures/wiki/server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR   = resolve(__dirname, '../../examples/wiki-docs/output');

const EXPECTED_COMPONENTS = ['Pipeline', 'HtmlScraper', 'MediaWikiScraper', 'LinkLister', 'TaskRegistry'];

interface RipperoniComponentOutput {
  _type: 'ripperoni_component';
  name: string;
  kind: string;
  since: string;
  description: string;
  source: string;
}

describe('wiki-docs e2e — MediaWiki scraper against fixture server', () => {
  let fixtureServer: WikiFixtureServerInterface;

  before(async () => {
    fixtureServer = await startWikiFixtureServer();
    // Load the example plugin module (for its exported node instances).
    await import('../../examples/wiki-docs/plugin.js');
    await mkdir(OUT_DIR, { recursive: true });
  });

  after(async () => {
    await fixtureServer.close();
  });

  it('fetches category members from fixture server and returns 5 components', async () => {
    const scraper = await MediaWikiScraper.create({
      apiUrl:      `${fixtureServer.baseUrl}/w/api.php`,
      rateLimitMs: 0,
    });

    const members = await scraper.fetchCategory('Core Components');
    assert.equal(members.length, 5, `expected 5 category members, got ${members.length.toString()}`);

    for (const title of EXPECTED_COMPONENTS) {
      assert.ok(
        members.some((m) => m.title === title),
        `expected member "${title}" in category response`,
      );
    }
  });

  it('scrapes all 5 components through the wiki-docs:parse node', async () => {
    const scraper = await MediaWikiScraper.create({
      apiUrl:      `${fixtureServer.baseUrl}/w/api.php`,
      rateLimitMs: 0,
    });

    const members = await scraper.fetchCategory('Core Components');
    const titles  = members.map((m) => m.title);
    const pages   = await scraper.fetchPagesBatch(titles);

    assert.equal(pages.length, 5, `expected 5 pages fetched, got ${pages.length.toString()}`);

    const { wikiDocsParseNode } = await import('../../examples/wiki-docs/plugin.js');

    const services = {
      log:    Logger.forComponent('wiki-docs-e2e'),
      cache:  null,
      target: { id: 'ripperoni-wiki', cfg: {} },
      outDir: OUT_DIR,
    } as unknown as RipperServices;
    const ctx = {
      services,
      signal:   new AbortController().signal,
      dagName:  'test',
      nodeName: 'wiki-docs:parse',
      runId:    'test',
    };

    const outputs: RipperoniComponentOutput[] = [];

    for (const page of pages) {
      const state = new ScrapeState();
      state.page  = { targetId: 'ripperoni-wiki', title: page.title, url: '', wikitext: page.wikitext };
      state.output = null;

      await wikiDocsParseNode.execute(state, ctx);

      assert.ok(state.output !== null, `expected output for "${page.title}", got null`);

      outputs.push(state.output as RipperoniComponentOutput);
    }

    assert.equal(outputs.length, 5, 'expected 5 ripperoni_component outputs');

    process.stdout.write(`\n  wiki-docs: extracted ${outputs.length.toString()} components from fixture server\n`);
    for (const c of outputs) {
      process.stdout.write(`    • ${c.name.padEnd(20)} kind=${c.kind.padEnd(8)} since=${c.since}\n`);
    }

    for (const c of outputs) {
      const slug    = c.name.toLowerCase();
      const outPath = resolve(OUT_DIR, `${slug}.json`);
      await writeFile(outPath, JSON.stringify(c, null, 2));
    }

    process.stdout.write(`  wrote ${outputs.length.toString()} JSON files to ${OUT_DIR}\n`);
  });

  it('all 5 outputs have required ripperoni_component fields', async () => {
    const scraper = await MediaWikiScraper.create({
      apiUrl:      `${fixtureServer.baseUrl}/w/api.php`,
      rateLimitMs: 0,
    });

    const members = await scraper.fetchCategory('Core Components');
    const pages   = await scraper.fetchPagesBatch(members.map((m) => m.title));

    const { wikiDocsParseNode } = await import('../../examples/wiki-docs/plugin.js');

    const services = {
      log:    Logger.forComponent('wiki-docs-fields'),
      cache:  null,
      target: { id: 'ripperoni-wiki', cfg: {} },
      outDir: OUT_DIR,
    } as unknown as RipperServices;
    const ctx = {
      services,
      signal:   new AbortController().signal,
      dagName:  'test',
      nodeName: 'wiki-docs:parse',
      runId:    'test',
    };

    for (const page of pages) {
      const state = new ScrapeState();
      state.page  = { targetId: 'ripperoni-wiki', title: page.title, url: '', wikitext: page.wikitext };
      state.output = null;

      await wikiDocsParseNode.execute(state, ctx);

      const c = state.output as RipperoniComponentOutput | null;
      assert.ok(c !== null, `"${page.title}" produced null output`);
      assert.ok(c.name.length > 0,        `"${page.title}": name is empty`);
      assert.ok(c.kind.length > 0,        `"${page.title}": kind is empty`);
      assert.ok(c.since.length > 0,       `"${page.title}": since is empty`);
      assert.ok(c.description.length > 0, `"${page.title}": description is empty`);
      assert.ok(c.source.length > 0,      `"${page.title}": source is empty`);
    }
  });
});
