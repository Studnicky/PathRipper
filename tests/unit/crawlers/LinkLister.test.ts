import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { LinkLister } from '../../../src/crawlers/LinkLister.js';

// LinkLister contract (preserved from original PathRipper):
//   - `domain`    keeps the crawler in scope
//   - `delimiter` is the superset of "interesting" URLs (followed OR collected)
//   - `target`    is the subset of delimiter-matching URLs to *collect* (vs. follow)
const PAGES: Record<string, string> = {
  'https://example.com/index': `
    <html><body>
      <a href="https://example.com/category/a">A category</a>
      <a href="https://example.com/category/b">B category</a>
      <a href="https://other.test/skip">offsite</a>
    </body></html>`,
  'https://example.com/category/a': `
    <html><body>
      <a href="https://example.com/category/item?id=1">item 1</a>
      <a href="https://example.com/category/item?id=2">item 2</a>
    </body></html>`,
  'https://example.com/category/b': `
    <html><body>
      <a href="https://example.com/category/item?id=3">item 3</a>
      <a href="https://example.com/category/item?id=1">duplicate item 1</a>
    </body></html>`,
};

const realFetch = globalThis.fetch;

describe('LinkLister', () => {
  before(() => {
    globalThis.fetch = (async (url: string | URL): Promise<Response> => {
      const key = typeof url === 'string' ? url : url.href;
      const body = PAGES[key];
      if (body === undefined) return new Response('', { status: 404 });
      return new Response(body, { status: 200 });
    }) as typeof fetch;
  });

  after(() => {
    globalThis.fetch = realFetch;
  });

  it('returns target-matching URLs, deduplicated, naturally sorted', async () => {
    const lister = new LinkLister({
      domain:      /example\.com/,
      target:      /\?id=/,
      delimiter:   /category/,
      rateLimitMs: 0,
    });

    const links = await lister.buildList(['https://example.com/index']);

    assert.deepEqual(links, [
      'https://example.com/category/item?id=1',
      'https://example.com/category/item?id=2',
      'https://example.com/category/item?id=3',
    ]);
  });

  it('does not confuse target with delimiter (Lane 01 regression)', async () => {
    const lister = new LinkLister({
      domain:      /example\.com/,
      target:      /\?id=/,
      delimiter:   /category/,
      rateLimitMs: 0,
    });
    const links = await lister.buildList(['https://example.com/index']);
    for (const link of links) {
      assert.match(link, /\?id=/);
      assert.doesNotMatch(link, /\/category\/[ab]$/);
    }
  });

  it('filters out offsite links via the domain regex', async () => {
    const lister = new LinkLister({
      domain:      /example\.com/,
      target:      /\?id=/,
      delimiter:   /category/,
      rateLimitMs: 0,
    });
    const links = await lister.buildList(['https://example.com/index']);
    for (const link of links) {
      assert.match(link, /example\.com/);
      assert.doesNotMatch(link, /other\.test/);
    }
  });

  it('honors maxPages cap (Lane 11 redesign)', async () => {
    const lister = new LinkLister({
      domain:      /example\.com/,
      target:      /\?id=/,
      delimiter:   /category/,
      rateLimitMs: 0,
      maxPages:    2,
    });
    const links = await lister.buildList(['https://example.com/index']);
    assert.equal(links.length, 2);
  });

  it('accepts multiple startUrls and de-duplicates results', async () => {
    const lister = new LinkLister({
      domain:      /example\.com/,
      target:      /\?id=/,
      delimiter:   /category/,
      rateLimitMs: 0,
    });
    const links = await lister.buildList([
      'https://example.com/index',
      'https://example.com/index',  // identical seed → must not double-count
    ]);
    assert.equal(links.length, 3);
  });
});
