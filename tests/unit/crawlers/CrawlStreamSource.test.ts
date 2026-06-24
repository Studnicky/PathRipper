import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { RateLimiter }     from '../../../src/modules/http/rateLimiter.js';
import { HttpRetryPolicy } from '../../../src/modules/http/httpRetryPolicy.js';
import { Logger }          from '../../../src/modules/logger/logger.js';
import type { RipperServices } from '../../../src/services/RipperServices.js';
import { CrawlStreamSource }  from '../../../src/crawlers/CrawlStreamSource.js';

// ── Fake site fixture ─────────────────────────────────────────────────────────

const SITE: Record<string, string> = {
  'https://example.com/index': `<html><body>
    <a href="/category/a">Cat A</a>
    <a href="/category/b">Cat B</a>
    <a href="https://other.test/skip">Offsite</a>
  </body></html>`,
  'https://example.com/category/a': `<html><body>
    <a href="/category/item?id=1">Item 1</a>
    <a href="/category/item?id=2">Item 2</a>
  </body></html>`,
  'https://example.com/category/b': `<html><body>
    <a href="/category/item?id=3">Item 3</a>
  </body></html>`,
  'https://example.com/category/item?id=1': '<html><body><h1>Item 1</h1></body></html>',
  'https://example.com/category/item?id=2': '<html><body><h1>Item 2</h1></body></html>',
  'https://example.com/category/item?id=3': '<html><body><h1>Item 3</h1></body></html>',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeFetch = (siteMap: Record<string, string>): typeof fetch =>
  (async (url: string | URL): Promise<Response> => {
    const key = typeof url === 'string' ? url : url.href;
    const body = siteMap[key];
    if (body === undefined) return new Response('Not Found', { status: 404 });
    return new Response(body, { status: 200 });
  }) as typeof fetch;

const makeServices = (overrides?: Partial<RipperServices['crawler']> & { crawlLimiter?: RipperServices['crawlLimiter']; crawlPolicy?: RipperServices['crawlPolicy'] }): RipperServices => {
  const { crawlLimiter: limiterOverride, crawlPolicy: policyOverride, ...crawlerOverrides } = overrides ?? {};
  return {
    log:          Logger.forComponent('CrawlStreamSourceTest'),
    cache:        null,
    target:       { id: 'test' },
    outDir:       '/tmp/test',
    dispatcher:   {} as RipperServices['dispatcher'],
    crawler: {
      startUrls: ['https://example.com/index'],
      domain:    'example\\.com',
      target:    '\\?id=',
      delimiter: 'category',
      ...crawlerOverrides,
    },
    crawlLimiter: limiterOverride ?? RateLimiter.create({ minTimeMs: 0 }),
    crawlPolicy:  policyOverride  ?? HttpRetryPolicy.create({ maxAttempts: 1 }),
  } as unknown as RipperServices;
};

// ── Module-level fetch mock ───────────────────────────────────────────────────

const realFetch = globalThis.fetch;

before(() => {
  globalThis.fetch = makeFetch(SITE);
});

after(() => {
  globalThis.fetch = realFetch;
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CrawlStreamSource.stream', () => {
  it('yields all 3 target URLs from the multi-level site', async () => {
    const services = makeServices();
    const results: string[] = [];
    for await (const url of CrawlStreamSource.stream(services)) {
      results.push(url);
    }
    assert.equal(results.length, 3);
    assert.ok(results.includes('https://example.com/category/item?id=1'));
    assert.ok(results.includes('https://example.com/category/item?id=2'));
    assert.ok(results.includes('https://example.com/category/item?id=3'));
  });

  it('stops after maxPages targets are discovered', async () => {
    const services = makeServices({ maxPages: 2 });
    const results: string[] = [];
    for await (const url of CrawlStreamSource.stream(services)) {
      results.push(url);
    }
    assert.equal(results.length, 2);
  });

  it('deduplicates targets that appear in multiple category pages', async () => {
    // Site where the same target URL appears in both category pages.
    const dupSite: Record<string, string> = {
      'https://example.com/index': `<html><body>
        <a href="/category/a">Cat A</a>
        <a href="/category/b">Cat B</a>
      </body></html>`,
      'https://example.com/category/a': `<html><body>
        <a href="/category/item?id=1">Item 1</a>
      </body></html>`,
      'https://example.com/category/b': `<html><body>
        <a href="/category/item?id=1">Item 1 again</a>
      </body></html>`,
      'https://example.com/category/item?id=1': '<html><body><h1>Item 1</h1></body></html>',
    };

    const savedFetch = globalThis.fetch;
    globalThis.fetch = makeFetch(dupSite);
    try {
      const services = makeServices();
      const results: string[] = [];
      for await (const url of CrawlStreamSource.stream(services)) {
        results.push(url);
      }
      assert.equal(results.length, 1, `expected 1 deduplicated result, got ${results.length.toString()}`);
      assert.ok(results.includes('https://example.com/category/item?id=1'));
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it('returns empty stream when crawler config is absent', async () => {
    const noConfig: RipperServices = {
      ...makeServices(),
      crawler: undefined,
    } as unknown as RipperServices;
    const results: string[] = [];
    for await (const url of CrawlStreamSource.stream(noConfig)) {
      results.push(url);
    }
    assert.equal(results.length, 0);
  });

  it('returns empty stream when crawlLimiter is absent', async () => {
    const noLimiter: RipperServices = {
      ...makeServices(),
      crawlLimiter: undefined,
    } as unknown as RipperServices;
    const results: string[] = [];
    for await (const url of CrawlStreamSource.stream(noLimiter)) {
      results.push(url);
    }
    assert.equal(results.length, 0);
  });

  it('does not call fetch until first next() call', async () => {
    let fetchCount = 0;
    const savedFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL): Promise<Response> => {
      fetchCount++;
      const key = typeof url === 'string' ? url : url.href;
      const body = SITE[key];
      if (body === undefined) return new Response('Not Found', { status: 404 });
      return new Response(body, { status: 200 });
    }) as typeof fetch;

    try {
      const services = makeServices();
      const iterable = CrawlStreamSource.stream(services);
      const iter = iterable[Symbol.asyncIterator]();

      assert.equal(fetchCount, 0, 'fetch should not be called before first next()');

      const first = await iter.next();
      assert.ok(!first.done, 'should yield at least one URL');
      assert.ok(fetchCount > 0, 'fetch should be called after first next()');

      // Drain the rest.
      while (!(await iter.next()).done) { /* drain */ }
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it('stops calling fetch after maxPages targets are produced', async () => {
    let fetchCount = 0;
    const savedFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL): Promise<Response> => {
      fetchCount++;
      const key = typeof url === 'string' ? url : url.href;
      const body = SITE[key];
      if (body === undefined) return new Response('Not Found', { status: 404 });
      return new Response(body, { status: 200 });
    }) as typeof fetch;

    try {
      const services = makeServices({ maxPages: 2 });
      const results: string[] = [];
      for await (const url of CrawlStreamSource.stream(services)) {
        results.push(url);
      }
      assert.equal(results.length, 2);
      // seed (1) + whichever category pages produced the 2 targets
      // Item pages are leaves — never fetched as traversables
      assert.ok(
        fetchCount <= 4,
        `expected ≤4 fetches for maxPages:2, got ${fetchCount.toString()}`,
      );
    } finally {
      globalThis.fetch = savedFetch;
    }
  });
});
