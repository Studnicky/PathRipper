import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MediaWikiScraper } from '../../../src/scrapers/MediaWikiScraper.js';
import { ScraperCache } from '../../../src/modules/cache/ScraperCache.js';
import { CacheMissError } from '../../../src/errors/CacheMissError.js';

const realFetch = globalThis.fetch;
const API_URL   = 'https://wiki.example.com/api.php';

/** Builds a fake MediaWiki revisions API response for the given titles. */
const fakeRevisionsResponse = (titles: string[]): string => {
  const pages: Record<string, unknown> = {};
  for (let i = 0; i < titles.length; i++) {
    const title = titles[i] ?? '';
    pages[String(i + 1)] = { title, pageid: i + 1, revisions: [{ '*': `wikitext:${title}` }] };
  }
  return JSON.stringify({ query: { pages } });
};

describe('MediaWikiScraper cache integration', () => {
  let tmpDir:     string;
  let fetchCalls: string[];

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ripperoni-wiki-cache-'));
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
      const u      = new URL(href);
      const titles = (u.searchParams.get('titles') ?? '').split('|').filter((t: string): boolean => t.length > 0);
      return new Response(fakeRevisionsResponse(titles), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
  });

  it('writes per-title entries on batch fetch and serves hits without re-fetching', async () => {
    const cacheDir = join(tmpDir, 'rw');
    const scraper  = await MediaWikiScraper.create({
      apiUrl:      API_URL,
      rateLimitMs: 0,
      cache: ScraperCache.create({ dir: cacheDir, mode: 'read-write' }),
    });

    const first = await scraper.fetchPagesBatch(['Alpha', 'Beta']);
    assert.equal(first.length, 2);
    assert.equal(fetchCalls.length, 1, 'first batch should issue one API call');

    const second = await scraper.fetchPagesBatch(['Alpha', 'Beta']);
    assert.equal(second.length, 2);
    assert.equal(fetchCalls.length, 1, 'fully-cached batch must not call the API');
    for (const page of second) {
      assert.equal(page.wikitext, `wikitext:${page.title}`);
    }
  });

  it('partitions partially-cached batches and only requests the missing titles', async () => {
    const cacheDir = join(tmpDir, 'partition');

    const cache  = ScraperCache.create({ dir: cacheDir, mode: 'read-write' });
    const key    = ScraperCache.keyFor({ method: 'GET', url: API_URL, headers: { titles: 'Alpha' } });
    await cache.write(key, 'wikitext:Alpha', { url: API_URL, method: 'GET', fetchedAt: new Date().toISOString(), status: 200 });

    const scraper = await MediaWikiScraper.create({
      apiUrl:      API_URL,
      rateLimitMs: 0,
      cache: ScraperCache.create({ dir: cacheDir, mode: 'read-write' }),
    });

    const result = await scraper.fetchPagesBatch(['Alpha', 'Beta', 'Gamma']);
    assert.equal(result.length, 3);
    assert.equal(fetchCalls.length, 1);
    const requestedTitles = new URL(fetchCalls[0] ?? '').searchParams.get('titles');
    assert.equal(requestedTitles, 'Beta|Gamma', 'only missing titles should be batched into the API call');
  });

  it('throws CacheMissError on read-only miss listing the missing titles', async () => {
    const cacheDir = join(tmpDir, 'ro-miss');
    const cache    = ScraperCache.create({ dir: cacheDir, mode: 'read-write' });
    const key      = ScraperCache.keyFor({ method: 'GET', url: API_URL, headers: { titles: 'Alpha' } });
    await cache.write(key, 'wikitext:Alpha', { url: API_URL, method: 'GET', fetchedAt: new Date().toISOString(), status: 200 });

    const scraper = await MediaWikiScraper.create({
      apiUrl:      API_URL,
      rateLimitMs: 0,
      cache: ScraperCache.create({ dir: cacheDir, mode: 'read-only' }),
    });

    await assert.rejects(
      () => scraper.fetchPagesBatch(['Alpha', 'Beta', 'Gamma']),
      (err: unknown): boolean => {
        if (!(err instanceof CacheMissError)) return false;
        const titles = (err.metadata?.['titles'] ?? []) as string[];
        return titles.includes('Beta') && titles.includes('Gamma') && !titles.includes('Alpha');
      },
    );
    assert.equal(fetchCalls.length, 0);
  });

  it('fetchPage delegates through the cache', async () => {
    const cacheDir = join(tmpDir, 'single');
    const scraper  = await MediaWikiScraper.create({
      apiUrl:      API_URL,
      rateLimitMs: 0,
      cache: ScraperCache.create({ dir: cacheDir, mode: 'read-write' }),
    });

    const first  = await scraper.fetchPage('Solo');
    assert.equal(first.title, 'Solo');
    assert.equal(first.wikitext, 'wikitext:Solo');
    assert.equal(fetchCalls.length, 1);

    const second = await scraper.fetchPage('Solo');
    assert.equal(second.wikitext, 'wikitext:Solo');
    assert.equal(fetchCalls.length, 1);
  });

  it('omitting cache config disables caching entirely', async () => {
    const scraper = await MediaWikiScraper.create({
      apiUrl:      API_URL,
      rateLimitMs: 0,
    });
    await scraper.fetchPagesBatch(['Alpha']);
    await scraper.fetchPagesBatch(['Alpha']);
    assert.equal(fetchCalls.length, 2);
  });
});
