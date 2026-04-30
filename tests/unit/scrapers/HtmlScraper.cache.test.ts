import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { HtmlScraper } from '../../../src/scrapers/HtmlScraper.js';
import { ScraperCache } from '../../../src/modules/cache/ScraperCache.js';
import { CacheMissError } from '../../../src/errors/CacheMissError.js';

const realFetch = globalThis.fetch;

describe('HtmlScraper cache integration', () => {
  let tmpDir:    string;
  let fetchCalls: string[];

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ripperoni-html-cache-'));
  });

  after(async () => {
    globalThis.fetch = realFetch;
    await rm(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    fetchCalls = [];
    globalThis.fetch = (async (url: string | URL): Promise<Response> => {
      const href = typeof url === 'string' ? url : url.href;
      fetchCalls.push(href);
      return new Response(`<html><body>fetched:${href}</body></html>`, { status: 200 });
    }) as typeof fetch;
  });

  it('writes to cache on first fetch in read-write mode and serves hits without fetching again', async () => {
    const cacheDir = join(tmpDir, 'rw');
    const scraper  = HtmlScraper.create({
      baseUrl:     'https://example.com',
      rateLimitMs: 0,
      cache: ScraperCache.create({ dir: cacheDir, mode: 'read-write' }),
    });

    const first = await scraper.fetchPage('/page-a');
    assert.match(first.html, /fetched:https:\/\/example.com\/page-a/);
    assert.equal(fetchCalls.length, 1);

    const second = await scraper.fetchPage('/page-a');
    assert.equal(second.html, first.html);
    assert.equal(fetchCalls.length, 1, 'cache hit must not consume the fetch path');

    const key = ScraperCache.keyFor({ method: 'GET', url: 'https://example.com/page-a', headers: {} });
    const direct = await ScraperCache.create({ dir: cacheDir, mode: 'read-only' }).read(key);
    assert.notEqual(direct, null);
    assert.equal(direct?.meta.url, 'https://example.com/page-a');
    assert.equal(direct?.meta.method, 'GET');
    assert.equal(direct?.meta.status, 200);
  });

  it('throws CacheMissError on read-only miss without invoking fetch', async () => {
    const cacheDir = join(tmpDir, 'ro-miss');
    const scraper  = HtmlScraper.create({
      baseUrl:     'https://example.com',
      rateLimitMs: 0,
      cache: ScraperCache.create({ dir: cacheDir, mode: 'read-only' }),
    });

    await assert.rejects(
      () => scraper.fetchPage('/missing'),
      (err: unknown): boolean => err instanceof CacheMissError && /missing/.test((err).message),
    );
    assert.equal(fetchCalls.length, 0, 'read-only must not hit the network');
  });

  it('serves a hit in read-only mode when the cache was pre-populated', async () => {
    const cacheDir = join(tmpDir, 'ro-hit');
    const cache    = ScraperCache.create({ dir: cacheDir, mode: 'read-write' });
    const url      = 'https://example.com/prepop';
    const key      = ScraperCache.keyFor({ method: 'GET', url, headers: {} });
    await cache.write(key, '<html>prepop</html>', { url, method: 'GET', fetchedAt: new Date().toISOString(), status: 200 });

    const scraper = HtmlScraper.create({
      baseUrl:     'https://example.com',
      rateLimitMs: 0,
      cache: ScraperCache.create({ dir: cacheDir, mode: 'read-only' }),
    });

    const result = await scraper.fetchPage('/prepop');
    assert.equal(result.html, '<html>prepop</html>');
    assert.equal(fetchCalls.length, 0);
  });

  it('write-only mode never reads but populates the cache', async () => {
    const cacheDir = join(tmpDir, 'wo');
    const scraper  = HtmlScraper.create({
      baseUrl:     'https://example.com',
      rateLimitMs: 0,
      cache: ScraperCache.create({ dir: cacheDir, mode: 'write-only' }),
    });

    await scraper.fetchPage('/wo-page');
    assert.equal(fetchCalls.length, 1);

    await scraper.fetchPage('/wo-page');
    assert.equal(fetchCalls.length, 2, 'write-only must always fetch');

    const key = ScraperCache.keyFor({ method: 'GET', url: 'https://example.com/wo-page', headers: {} });
    const entry = await ScraperCache.create({ dir: cacheDir, mode: 'read-only' }).read(key);
    assert.notEqual(entry, null);
  });

  it('omitting cache config disables caching entirely', async () => {
    const scraper = HtmlScraper.create({
      baseUrl:     'https://example.com',
      rateLimitMs: 0,
    });
    await scraper.fetchPage('/no-cache');
    await scraper.fetchPage('/no-cache');
    assert.equal(fetchCalls.length, 2);
  });
});
