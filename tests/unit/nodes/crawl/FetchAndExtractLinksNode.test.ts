import { describe, it, before, after } from 'node:test';
import { Batch } from '@studnicky/dagonizer';
import assert from 'node:assert/strict';

import { FetchAndExtractLinksNode } from '../../../../src/nodes/crawl/FetchAndExtractLinksNode.js';
import { makeState, makeHttpContext } from './helpers.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const PAGES: Record<string, string> = {
  'https://example.com/index': `
    <html><body>
      <a href="/category/a">A</a>
      <a href="/category/b">B</a>
      <a href="https://other.test/skip">offsite</a>
    </body></html>`,
  'https://example.com/category/a': `
    <html><body>
      <a href="/category/item?id=1">item 1</a>
      <a href="/category/item?id=2">item 2</a>
    </body></html>`,
};

const realFetch = globalThis.fetch;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('FetchAndExtractLinksNode', () => {
  before(() => {
    globalThis.fetch = (async (url: string | URL): Promise<Response> => {
      const key = typeof url === 'string' ? url : url.href;
      const body = PAGES[key];
      if (body === undefined) return new Response('Not Found', { status: 404 });
      return new Response(body, { status: 200 });
    }) as typeof fetch;
  });

  after(() => {
    globalThis.fetch = realFetch;
  });

  it('routes empty when frontier is empty', async () => {
    const state = makeState({ frontier: [] });
    const result = await FetchAndExtractLinksNode.execute(Batch.of(state), makeHttpContext());
    assert.ok(result.has('empty'));
  });

  it('routes error when crawlLimiter/crawlPolicy absent', async () => {
    // No limiter/policy provided — makeTestContext without them
    const { makeTestContext: makeCtx } = await import('./helpers.js');
    const state = makeState({ frontier: ['https://example.com/index'] });
    // Context has no crawlLimiter/crawlPolicy
    const ctx = makeCtx({ startUrls: [], domain: 'example\\.com', target: '\\?id=', delimiter: 'category' });
    const result = await FetchAndExtractLinksNode.execute(Batch.of(state), ctx);
    assert.ok(result.has('error'));
  });

  it('collects target links into crawl.discoveredRaw', async () => {
    const state = makeState({
      frontier:    ['https://example.com/category/a'],
      domainRe:    'example\\.com',
      delimiterRe: 'category',
      targetRe:    '\\?id=',
    });

    const result = await FetchAndExtractLinksNode.execute(Batch.of(state), makeHttpContext());

    assert.ok(result.has('success'));
    assert.ok(state.crawl.discoveredRaw.includes('https://example.com/category/item?id=1'));
    assert.ok(state.crawl.discoveredRaw.includes('https://example.com/category/item?id=2'));
  });

  it('puts traversable (non-target) links into crawl.nextFrontierRaw', async () => {
    const state = makeState({
      frontier:    ['https://example.com/index'],
      domainRe:    'example\\.com',
      delimiterRe: 'category',
      targetRe:    '\\?id=',
    });

    await FetchAndExtractLinksNode.execute(Batch.of(state), makeHttpContext());

    assert.ok(state.crawl.nextFrontierRaw.includes('https://example.com/category/a'));
    assert.ok(state.crawl.nextFrontierRaw.includes('https://example.com/category/b'));
    assert.ok(!state.crawl.nextFrontierRaw.includes('https://other.test/skip'));
  });

  it('filters offsite links via domainRe', async () => {
    const state = makeState({
      frontier:    ['https://example.com/index'],
      domainRe:    'example\\.com',
      delimiterRe: 'category',
      targetRe:    '\\?id=',
    });

    await FetchAndExtractLinksNode.execute(Batch.of(state), makeHttpContext());

    const allLinks = [...state.crawl.discoveredRaw, ...state.crawl.nextFrontierRaw];
    for (const link of allLinks) {
      assert.match(link, /example\.com/);
    }
  });

  it('routes permanent on 404 with no links found', async () => {
    const state = makeState({
      frontier:    ['https://example.com/not-found-url-xyz'],
      domainRe:    'example\\.com',
      delimiterRe: 'category',
      targetRe:    '\\?id=',
    });
    const result = await FetchAndExtractLinksNode.execute(Batch.of(state), makeHttpContext());
    assert.ok(result.has('permanent'));
  });

  it('marks visited URLs in crawl.visited after processing', async () => {
    const state = makeState({
      frontier: ['https://example.com/category/a'],
    });

    await FetchAndExtractLinksNode.execute(Batch.of(state), makeHttpContext());
    assert.ok(state.crawl.visited.includes('https://example.com/category/a'));
  });

  it('respects maxPages budget from services.crawler', async () => {
    const state = makeState({
      frontier:    ['https://example.com/category/a'],
      domainRe:    'example\\.com',
      delimiterRe: 'category',
      targetRe:    '\\?id=',
    });

    // maxPages: 1 — only one discovered URL should be collected
    const result = await FetchAndExtractLinksNode.execute(
      Batch.of(state),
      makeHttpContext(undefined, 1),
    );

    assert.ok(result.has('success'));
    assert.equal(state.crawl.discoveredRaw.length, 1);
  });
});
