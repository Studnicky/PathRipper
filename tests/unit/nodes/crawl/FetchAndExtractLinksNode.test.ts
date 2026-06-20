import { describe, it, before, after } from 'node:test';
import { Batch } from '@studnicky/dagonizer';
import assert from 'node:assert/strict';

import { FetchAndExtractLinksNode } from '../../../../src/nodes/crawl/FetchAndExtractLinksNode.js';
import { makeState }                from './helpers.js';
import type { NodeContextType } from '@studnicky/dagonizer';
import type { LinkCrawlServices }   from '../../../../src/nodes/crawl/Services.js';
import { RateLimiter }              from '../../../../src/modules/http/rateLimiter.js';
import { HttpRetryPolicy }          from '../../../../src/modules/http/httpRetryPolicy.js';

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

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeCtx = (): NodeContextType<LinkCrawlServices> => {
  const limiter = RateLimiter.create({ minTimeMs: 0 });
  const policy  = HttpRetryPolicy.create({ maxAttempts: 1 });
  return {
    dagName:  'test',
    nodeName: 'test',
    signal:   new AbortController().signal,
    services: {
      log: {
        debug: () => {},
        info:  () => {},
        warn:  () => {},
        error: () => {},
      } as unknown as LinkCrawlServices['log'],
      cache:      null,
      limiter,
      policy,
      dispatcher: {} as LinkCrawlServices['dispatcher'],
    },
  };
};

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
    const result = await FetchAndExtractLinksNode.execute(Batch.of(state), makeCtx());
    assert.ok(result.has('empty'));
  });

  it('collects target links into discoveredRaw', async () => {
    const state = makeState({
      frontier:    ['https://example.com/category/a'],
      domainRe:    'example\\.com',
      delimiterRe: 'category',
      targetRe:    '\\?id=',
    });

    const result = await FetchAndExtractLinksNode.execute(Batch.of(state), makeCtx());

    assert.ok(result.has('success'));
    assert.ok(state.discoveredRaw.includes('https://example.com/category/item?id=1'));
    assert.ok(state.discoveredRaw.includes('https://example.com/category/item?id=2'));
  });

  it('puts traversable (non-target) links into nextFrontierRaw', async () => {
    const state = makeState({
      frontier:    ['https://example.com/index'],
      domainRe:    'example\\.com',
      delimiterRe: 'category',
      targetRe:    '\\?id=',
    });

    await FetchAndExtractLinksNode.execute(Batch.of(state), makeCtx());

    assert.ok(state.nextFrontierRaw.includes('https://example.com/category/a'));
    assert.ok(state.nextFrontierRaw.includes('https://example.com/category/b'));
    assert.ok(!state.nextFrontierRaw.includes('https://other.test/skip'));
  });

  it('filters offsite links via domainRe', async () => {
    const state = makeState({
      frontier:    ['https://example.com/index'],
      domainRe:    'example\\.com',
      delimiterRe: 'category',
      targetRe:    '\\?id=',
    });

    await FetchAndExtractLinksNode.execute(Batch.of(state), makeCtx());

    const allLinks = [...state.discoveredRaw, ...state.nextFrontierRaw];
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
    const result = await FetchAndExtractLinksNode.execute(Batch.of(state), makeCtx());
    assert.ok(result.has('permanent'));
  });

  it('marks visited URLs after processing', async () => {
    const state = makeState({
      frontier: ['https://example.com/category/a'],
    });

    await FetchAndExtractLinksNode.execute(Batch.of(state), makeCtx());
    assert.ok(state.visited.includes('https://example.com/category/a'));
  });
});
