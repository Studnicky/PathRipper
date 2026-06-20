import { describe, it } from 'node:test';
import { Batch } from '@studnicky/dagonizer';
import assert from 'node:assert/strict';

import { CrawlExhaustedNode } from '../../../../src/nodes/crawl/CrawlExhaustedNode.js';
import { makeTestContext, makeState } from './helpers.js';

describe('CrawlExhaustedNode', () => {
  it('always routes success', async () => {
    const state = makeState();
    const result = await CrawlExhaustedNode.execute(Batch.of(state), makeTestContext());
    assert.ok(result.has('success'));
  });

  it('sorts discovered URLs with numeric-aware collation', async () => {
    const state = makeState();
    state.discovered = [
      'https://example.com/item?id=10',
      'https://example.com/item?id=2',
      'https://example.com/item?id=1',
    ];
    await CrawlExhaustedNode.execute(Batch.of(state), makeTestContext());
    assert.deepEqual(state.discovered, [
      'https://example.com/item?id=1',
      'https://example.com/item?id=2',
      'https://example.com/item?id=10',
    ]);
  });

  it('deduplicates discovered URLs', async () => {
    const state = makeState();
    state.discovered = [
      'https://example.com/item?id=1',
      'https://example.com/item?id=1',
      'https://example.com/item?id=2',
    ];
    await CrawlExhaustedNode.execute(Batch.of(state), makeTestContext());
    assert.equal(state.discovered.length, 2);
  });

  it('truncates to maxPages', async () => {
    const state = makeState({ maxPages: 2 });
    state.discovered = [
      'https://example.com/item?id=1',
      'https://example.com/item?id=2',
      'https://example.com/item?id=3',
    ];
    await CrawlExhaustedNode.execute(Batch.of(state), makeTestContext());
    assert.equal(state.discovered.length, 2);
  });
});
