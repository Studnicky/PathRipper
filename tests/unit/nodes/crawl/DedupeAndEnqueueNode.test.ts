import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { DedupeAndEnqueueNode } from '../../../../src/nodes/crawl/DedupeAndEnqueueNode.js';
import { makeTestContext, makeState } from './helpers.js';

describe('DedupeAndEnqueueNode', () => {
  it('promotes discoveredRaw into discovered and deduplicates', async () => {
    const state = makeState({ discovered: ['https://example.com/category/item?id=1'] });
    state.discoveredRaw   = ['https://example.com/category/item?id=1', 'https://example.com/category/item?id=2'];
    state.nextFrontierRaw = [];

    await DedupeAndEnqueueNode.execute(state, makeTestContext());

    assert.deepEqual(state.discovered, [
      'https://example.com/category/item?id=1',
      'https://example.com/category/item?id=2',
    ]);
    assert.deepEqual(state.discoveredRaw, []);
  });

  it('routes frontier-ready when new traversable URLs exist', async () => {
    const state = makeState({
      visited: ['https://example.com/index'],
    });
    state.nextFrontierRaw = ['https://example.com/category/a', 'https://example.com/category/b'];

    const result = await DedupeAndEnqueueNode.execute(state, makeTestContext());

    assert.equal(result.output, 'frontier-ready');
    assert.deepEqual(state.frontier, ['https://example.com/category/a', 'https://example.com/category/b']);
    assert.deepEqual(state.nextFrontierRaw, []);
    assert.equal(state.depth, 1);
  });

  it('routes frontier-empty when no new traversable URLs', async () => {
    const state = makeState();
    state.nextFrontierRaw = [];

    const result = await DedupeAndEnqueueNode.execute(state, makeTestContext());
    assert.equal(result.output, 'frontier-empty');
    assert.deepEqual(state.frontier, []);
  });

  it('deduplicates nextFrontierRaw against visited', async () => {
    const state = makeState({ visited: ['https://example.com/category/a'] });
    state.nextFrontierRaw = [
      'https://example.com/category/a',  // visited — skip
      'https://example.com/category/b',  // new
      'https://example.com/category/b',  // duplicate — skip
    ];

    const result = await DedupeAndEnqueueNode.execute(state, makeTestContext());

    assert.equal(result.output, 'frontier-ready');
    assert.deepEqual(state.frontier, ['https://example.com/category/b']);
  });

  it('routes budget-exhausted when maxPages already reached', async () => {
    const state = makeState({ maxPages: 2, discovered: ['a', 'b'] });
    state.nextFrontierRaw = ['https://example.com/more'];

    const result = await DedupeAndEnqueueNode.execute(state, makeTestContext());
    assert.equal(result.output, 'budget-exhausted');
    assert.deepEqual(state.frontier, []);
  });

  it('routes budget-exhausted when maxDepth reached', async () => {
    const state = makeState({ maxDepth: 2, depth: 2 });
    state.nextFrontierRaw = ['https://example.com/category/c'];

    const result = await DedupeAndEnqueueNode.execute(state, makeTestContext());
    assert.equal(result.output, 'budget-exhausted');
    assert.deepEqual(state.frontier, []);
  });

  it('increments depth on frontier-ready', async () => {
    const state = makeState({ depth: 1 });
    state.nextFrontierRaw = ['https://example.com/category/x'];

    await DedupeAndEnqueueNode.execute(state, makeTestContext());
    assert.equal(state.depth, 2);
  });
});
