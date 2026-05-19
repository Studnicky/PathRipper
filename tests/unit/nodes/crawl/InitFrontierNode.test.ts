import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { InitFrontierNode } from '../../../../src/nodes/crawl/InitFrontierNode.js';
import { LinkCrawlState }   from '../../../../src/state/LinkCrawlState.js';
import { makeTestContext }  from './helpers.js';

describe('InitFrontierNode', () => {
  it('routes empty when seedUrls is empty', async () => {
    const state = new LinkCrawlState();
    state.seedUrls = [];
    const result = await InitFrontierNode.execute(state, makeTestContext());
    assert.equal(result.output, 'empty');
  });

  it('routes ready and initialises frontier from seedUrls', async () => {
    const state = new LinkCrawlState();
    state.seedUrls = ['https://example.com/a', 'https://example.com/b'];
    const result = await InitFrontierNode.execute(state, makeTestContext());
    assert.equal(result.output, 'ready');
    assert.deepEqual(state.frontier, ['https://example.com/a', 'https://example.com/b']);
  });

  it('resets visited, discovered, and accumulators', async () => {
    const state = new LinkCrawlState();
    state.seedUrls       = ['https://example.com/'];
    state.visited        = ['https://example.com/old'];
    state.discovered     = ['https://example.com/old-target'];
    state.discoveredRaw  = ['stale'];
    state.nextFrontierRaw = ['stale'];
    state.depth = 5;

    await InitFrontierNode.execute(state, makeTestContext());

    assert.deepEqual(state.visited,         []);
    assert.deepEqual(state.discovered,      []);
    assert.deepEqual(state.discoveredRaw,   []);
    assert.deepEqual(state.nextFrontierRaw, []);
    assert.equal(state.depth, 0);
  });
});
