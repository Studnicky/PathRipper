import { describe, it } from 'node:test';
import { Batch } from '@studnicky/dagonizer';
import assert from 'node:assert/strict';

import { InitFrontierNode } from '../../../../src/nodes/crawl/InitFrontierNode.js';
import { ScrapeState }      from '../../../../src/state/ScrapeState.js';
import { makeTestContext }  from './helpers.js';

describe('InitFrontierNode', () => {
  it('routes empty when crawler is not configured', async () => {
    const state = new ScrapeState();
    const result = await InitFrontierNode.execute(Batch.of(state), makeTestContext());
    assert.ok(result.has('empty'));
  });

  it('routes empty when startUrls is empty', async () => {
    const state = new ScrapeState();
    const result = await InitFrontierNode.execute(
      Batch.of(state),
      makeTestContext({ startUrls: [] }),
    );
    assert.ok(result.has('empty'));
  });

  it('routes ready and initialises frontier from startUrls', async () => {
    const state = new ScrapeState();
    const result = await InitFrontierNode.execute(
      Batch.of(state),
      makeTestContext({ startUrls: ['https://example.com/a', 'https://example.com/b'] }),
    );
    assert.ok(result.has('ready'));
    assert.deepEqual(state.crawl.frontier, ['https://example.com/a', 'https://example.com/b']);
  });

  it('resets visited, discovered, and accumulators', async () => {
    const state = new ScrapeState();
    // Pre-populate stale crawl state to verify reset
    state.crawl = {
      ...state.crawl,
      frontier:        ['stale'],
      visited:         ['https://example.com/old'],
      discovered:      ['https://example.com/old-target'],
      discoveredRaw:   ['stale'],
      nextFrontierRaw: ['stale'],
      depth:           5,
    };

    await InitFrontierNode.execute(
      Batch.of(state),
      makeTestContext({ startUrls: ['https://example.com/'] }),
    );

    assert.deepEqual(state.crawl.visited,         []);
    assert.deepEqual(state.crawl.discovered,      []);
    assert.deepEqual(state.crawl.discoveredRaw,   []);
    assert.deepEqual(state.crawl.nextFrontierRaw, []);
    assert.equal(state.crawl.depth, 0);
  });

  it('seeds regex fields from crawler config', async () => {
    const state = new ScrapeState();
    await InitFrontierNode.execute(
      Batch.of(state),
      makeTestContext({
        startUrls: ['https://example.com/'],
        domain:    'example\\.com',
        target:    '\\?id=',
        delimiter: 'category',
      }),
    );
    assert.equal(state.crawl.domainRe,    'example\\.com');
    assert.equal(state.crawl.targetRe,    '\\?id=');
    assert.equal(state.crawl.delimiterRe, 'category');
  });
});
