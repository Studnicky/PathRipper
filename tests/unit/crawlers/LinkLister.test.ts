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

// ── Termination tests (cyclic back-edge loop) ──────────────────────────────────
//
// These tests prove the native back-edge loop terminates correctly without
// any trampoline or re-dispatch. A three-level fixture is used so the crawl
// must iterate the back-edge multiple times before exhaustion.
//
// Fixture topology:
//   /root → /level1/a, /level1/b           (seed level: depth 0)
//   /level1/a → /level2/a1, /level2/a2     (depth 1)
//   /level1/b → /level2/b1                 (depth 1)
//   /level2/* → /items/N?id=N              (depth 2 — target URLs)
//
// domain:    deep.example.com
// delimiter: /level|/items                 (traversal + target URLs — superset)
// target:    /items/.*\?id=                (collected URLs)

const DEEP_PAGES: Record<string, string> = {
  'https://deep.example.com/root': `
    <html><body>
      <a href="https://deep.example.com/level1/a">level 1 a</a>
      <a href="https://deep.example.com/level1/b">level 1 b</a>
    </body></html>`,
  'https://deep.example.com/level1/a': `
    <html><body>
      <a href="https://deep.example.com/level2/a1">level 2 a1</a>
      <a href="https://deep.example.com/level2/a2">level 2 a2</a>
    </body></html>`,
  'https://deep.example.com/level1/b': `
    <html><body>
      <a href="https://deep.example.com/level2/b1">level 2 b1</a>
    </body></html>`,
  'https://deep.example.com/level2/a1': `
    <html><body>
      <a href="https://deep.example.com/items/1?id=1">item 1</a>
    </body></html>`,
  'https://deep.example.com/level2/a2': `
    <html><body>
      <a href="https://deep.example.com/items/2?id=2">item 2</a>
    </body></html>`,
  'https://deep.example.com/level2/b1': `
    <html><body>
      <a href="https://deep.example.com/items/3?id=3">item 3</a>
      <a href="https://deep.example.com/items/1?id=1">item 1 dupe</a>
    </body></html>`,
};

const realDeepFetch = globalThis.fetch;

describe('LinkLister — cyclic back-edge loop termination', () => {
  let cacheDir: string;
  let cache:    ScraperCache;

  before(() => {
    globalThis.fetch = (async (url: string | URL): Promise<Response> => {
      const key = typeof url === 'string' ? url : url.href;
      const body = DEEP_PAGES[key];
      if (body === undefined) return new Response('', { status: 404 });
      return new Response(body, { status: 200 });
    }) as typeof fetch;
  });

  after(() => {
    globalThis.fetch = realDeepFetch;
  });

  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), 'linklister-deep-'));
    cache    = ScraperCache.create({ dir: cacheDir, mode: 'read-write' });
  });

  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  it('terminates naturally after exhausting a three-level fixture', async () => {
    const lister = LinkLister.create({
      domain:      /deep\.example\.com/,
      target:      /\/items\/.*\?id=/,
      delimiter:   /level|items/,
      rateLimitMs: 0,
      cache,
    });
    const links = await lister.buildList(['https://deep.example.com/root']);
    // All 3 unique item URLs must be collected, deduplicated, and sorted
    assert.deepEqual(links, [
      'https://deep.example.com/items/1?id=1',
      'https://deep.example.com/items/2?id=2',
      'https://deep.example.com/items/3?id=3',
    ]);
  });

  it('terminates early when maxPages cap is hit mid-loop', async () => {
    const lister = LinkLister.create({
      domain:      /deep\.example\.com/,
      target:      /\/items\/.*\?id=/,
      delimiter:   /level|items/,
      rateLimitMs: 0,
      maxPages:    2,
      cache,
    });
    const links = await lister.buildList(['https://deep.example.com/root']);
    // Must stop at 2 targets — proves budget-exhausted exits the back-edge loop
    assert.equal(links.length, 2);
  });

  it('behaviorally equivalent to old multi-level result — same discovered set', async () => {
    // Full three-level crawl with no cap: 3 unique items across 3 depth iterations
    const lister = LinkLister.create({
      domain:      /deep\.example\.com/,
      target:      /\/items\/.*\?id=/,
      delimiter:   /level|items/,
      rateLimitMs: 0,
      cache,
    });
    const links = await lister.buildList(['https://deep.example.com/root']);
    assert.equal(links.length, 3, 'all 3 unique items must be discovered across the full loop');
    for (const link of links) {
      assert.match(link, /\/items\/\d+\?id=\d+/, `unexpected link shape: ${link}`);
    }
  });
});
