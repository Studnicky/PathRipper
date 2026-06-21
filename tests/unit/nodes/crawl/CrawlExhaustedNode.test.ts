import { describe, it } from 'node:test';
import { Batch } from '@studnicky/dagonizer';
import assert from 'node:assert/strict';

import { CrawlExhaustedNode }       from '../../../../src/nodes/crawl/CrawlExhaustedNode.js';
import { makeTestContext, makeState } from './helpers.js';

describe('CrawlExhaustedNode', () => {
  it('always routes success', async () => {
    const state = makeState();
    const result = await CrawlExhaustedNode.execute(Batch.of(state), makeTestContext());
    assert.ok(result.has('success'));
  });

  it('sorts crawl.discovered URLs with numeric-aware collation', async () => {
    const state = makeState();
    state.crawl.discovered = [
      'https://example.com/item?id=10',
      'https://example.com/item?id=2',
      'https://example.com/item?id=1',
    ];
    await CrawlExhaustedNode.execute(Batch.of(state), makeTestContext());
    assert.deepEqual(state.crawl.discovered, [
      'https://example.com/item?id=1',
      'https://example.com/item?id=2',
      'https://example.com/item?id=10',
    ]);
  });

  it('deduplicates crawl.discovered URLs', async () => {
    const state = makeState();
    state.crawl.discovered = [
      'https://example.com/item?id=1',
      'https://example.com/item?id=1',
      'https://example.com/item?id=2',
    ];
    await CrawlExhaustedNode.execute(Batch.of(state), makeTestContext());
    assert.equal(state.crawl.discovered.length, 2);
  });

  it('truncates to maxPages (from services.crawler)', async () => {
    const state = makeState();
    state.crawl.discovered = [
      'https://example.com/item?id=1',
      'https://example.com/item?id=2',
      'https://example.com/item?id=3',
    ];
    const ctx = makeTestContext({ maxPages: 2 });
    await CrawlExhaustedNode.execute(Batch.of(state), ctx);
    assert.equal(state.crawl.discovered.length, 2);
  });
});
