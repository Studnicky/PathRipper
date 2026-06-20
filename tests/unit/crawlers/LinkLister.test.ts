import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LinkLister } from '../../../src/crawlers/LinkLister.js';
import { ScraperCache } from '../../../src/modules/cache/ScraperCache.js';

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
  let cacheDir: string;
  let cache:    ScraperCache;

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

  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), 'linklister-cache-'));
    cache    = ScraperCache.create({ dir: cacheDir, mode: 'read-write' });
  });

  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  it('returns target-matching URLs, deduplicated, naturally sorted', async () => {
    const lister = LinkLister.create({
      domain:      /example\.com/,
      target:      /\?id=/,
      delimiter:   /category/,
      rateLimitMs: 0,
      cache,
    });

    const links = await lister.buildList(['https://example.com/index']);

    assert.deepEqual(links, [
      'https://example.com/category/item?id=1',
      'https://example.com/category/item?id=2',
      'https://example.com/category/item?id=3',
    ]);
  });

  it('does not confuse target with delimiter (Lane 01 regression)', async () => {
    const lister = LinkLister.create({
      domain:      /example\.com/,
      target:      /\?id=/,
      delimiter:   /category/,
      rateLimitMs: 0,
      cache,
    });
    const links = await lister.buildList(['https://example.com/index']);
    for (const link of links) {
      assert.match(link, /\?id=/);
      assert.doesNotMatch(link, /\/category\/[ab]$/);
    }
  });

  it('filters out offsite links via the domain regex', async () => {
    const lister = LinkLister.create({
      domain:      /example\.com/,
      target:      /\?id=/,
      delimiter:   /category/,
      rateLimitMs: 0,
      cache,
    });
    const links = await lister.buildList(['https://example.com/index']);
    for (const link of links) {
      assert.match(link, /example\.com/);
      assert.doesNotMatch(link, /other\.test/);
    }
  });

  it('honors maxPages cap (Lane 11 redesign)', async () => {
    const lister = LinkLister.create({
      domain:      /example\.com/,
      target:      /\?id=/,
      delimiter:   /category/,
      rateLimitMs: 0,
      maxPages:    2,
      cache,
    });
    const links = await lister.buildList(['https://example.com/index']);
    assert.equal(links.length, 2);
  });

  it('accepts multiple startUrls and de-duplicates results', async () => {
    const lister = LinkLister.create({
      domain:      /example\.com/,
      target:      /\?id=/,
      delimiter:   /category/,
      rateLimitMs: 0,
      cache,
    });
    const links = await lister.buildList([
      'https://example.com/index',
      'https://example.com/index',  // identical seed → must not double-count
    ]);
    assert.equal(links.length, 3);
  });

  it('serves cached bodies on the second pass without hitting the network', async () => {
    const fetchCalls: string[] = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL): Promise<Response> => {
      const key = typeof url === 'string' ? url : url.href;
      fetchCalls.push(key);
      const body = PAGES[key];
      if (body === undefined) return new Response('', { status: 404 });
      return new Response(body, { status: 200 });
    }) as typeof fetch;
    try {
      const listerA = LinkLister.create({
        domain: /example\.com/, target: /\?id=/, delimiter: /category/, rateLimitMs: 0, cache,
      });
      await listerA.buildList(['https://example.com/index']);
      const networkCallsAfterFirst = fetchCalls.length;
      assert.ok(networkCallsAfterFirst > 0);

      const listerB = LinkLister.create({
        domain: /example\.com/, target: /\?id=/, delimiter: /category/, rateLimitMs: 0, cache,
      });
      await listerB.buildList(['https://example.com/index']);
      assert.equal(fetchCalls.length, networkCallsAfterFirst, 'second crawl must hit only the cache');
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
