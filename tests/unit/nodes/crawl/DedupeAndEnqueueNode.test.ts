import { describe, it } from 'node:test';
import { Batch } from '@studnicky/dagonizer';
import assert from 'node:assert/strict';

import { DedupeAndEnqueueNode }     from '../../../../src/nodes/crawl/DedupeAndEnqueueNode.js';
import { makeTestContext, makeState } from './helpers.js';

describe('DedupeAndEnqueueNode', () => {
  it('promotes crawl.discoveredRaw into crawl.discovered and deduplicates', async () => {
    const state = makeState({ discovered: ['https://example.com/category/item?id=1'] });
    state.crawl.discoveredRaw   = ['https://example.com/category/item?id=1', 'https://example.com/category/item?id=2'];
    state.crawl.nextFrontierRaw = [];

    await DedupeAndEnqueueNode.execute(Batch.of(state), makeTestContext());

    assert.deepEqual(state.crawl.discovered, [
      'https://example.com/category/item?id=1',
      'https://example.com/category/item?id=2',
    ]);
    assert.deepEqual(state.crawl.discoveredRaw, []);
  });

  it('routes frontier-ready when new traversable URLs exist', async () => {
    const state = makeState({
      visited: ['https://example.com/index'],
    });
    state.crawl.nextFrontierRaw = ['https://example.com/category/a', 'https://example.com/category/b'];

    const result = await DedupeAndEnqueueNode.execute(Batch.of(state), makeTestContext());

    assert.ok(result.has('frontier-ready'));
    assert.deepEqual(state.crawl.frontier, ['https://example.com/category/a', 'https://example.com/category/b']);
    assert.deepEqual(state.crawl.nextFrontierRaw, []);
    assert.equal(state.crawl.depth, 1);
  });

  it('routes frontier-empty when no new traversable URLs', async () => {
    const state = makeState();
    state.crawl.nextFrontierRaw = [];

    const result = await DedupeAndEnqueueNode.execute(Batch.of(state), makeTestContext());
    assert.ok(result.has('frontier-empty'));
    assert.deepEqual(state.crawl.frontier, []);
  });

  it('deduplicates nextFrontierRaw against visited', async () => {
    const state = makeState({ visited: ['https://example.com/category/a'] });
    state.crawl.nextFrontierRaw = [
      'https://example.com/category/a',  // visited — skip
      'https://example.com/category/b',  // new
      'https://example.com/category/b',  // duplicate — skip
    ];

    const result = await DedupeAndEnqueueNode.execute(Batch.of(state), makeTestContext());

    assert.ok(result.has('frontier-ready'));
    assert.deepEqual(state.crawl.frontier, ['https://example.com/category/b']);
  });

  it('routes budget-exhausted when maxPages already reached (via crawler config)', async () => {
    const state = makeState({ discovered: ['a', 'b'] });
    state.crawl.nextFrontierRaw = ['https://example.com/more'];

    const ctx = makeTestContext({ maxPages: 2 });
    const result = await DedupeAndEnqueueNode.execute(Batch.of(state), ctx);
    assert.ok(result.has('budget-exhausted'));
    assert.deepEqual(state.crawl.frontier, []);
  });

  it('routes budget-exhausted when maxDepth reached', async () => {
    const state = makeState({ maxDepth: 2, depth: 2 });
    state.crawl.nextFrontierRaw = ['https://example.com/category/c'];

    const result = await DedupeAndEnqueueNode.execute(Batch.of(state), makeTestContext());
    assert.ok(result.has('budget-exhausted'));
    assert.deepEqual(state.crawl.frontier, []);
  });

  it('increments depth on frontier-ready', async () => {
    const state = makeState({ depth: 1 });
    state.crawl.nextFrontierRaw = ['https://example.com/category/x'];

    await DedupeAndEnqueueNode.execute(Batch.of(state), makeTestContext());
    assert.equal(state.crawl.depth, 2);
  });
});
