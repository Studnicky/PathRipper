// Unit tests for the failure-retry phase DAGs.
//
// Verifies that:
//   • htmlRetryPhase fans out over state.failed, partitions into recovered / failedAfterRetry.
//   • A dispatch node that returns 'success' on retry moves the item to state.recovered.
//   • A dispatch node that returns 'error' on retry moves the item to state.failedAfterRetry.
//
// The phase is dispatched directly (independent of the outer composition DAG)
// so each phase is testable in isolation.
//
// Phase DAGs are built with DAGBuilder.fanOut, matching how runHtml constructs
// them. The FlowDeriver-derived htmlRetryPhaseFlow (src/flows/htmlScrapeFlow.ts)
// is a visualization artifact and not dispatch-compatible with the real node set.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Dagonizer } from '@noocodex/dagonizer';
import { DAGBuilder } from '@noocodex/dagonizer/builder';
import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';

import { ScrapeState }       from '../../../src/state/ScrapeState.js';
import type { RipperServices }  from '../../../src/services/RipperServices.js';
import { Logger }            from '../../../src/modules/logger/logger.js';

const HTML_RETRY_PHASE = 'htmlRetryPhase';

// ── Mock dispatch nodes ────────────────────────────────────────────────────────

const succeedingDispatchNode: NodeInterface<ScrapeState, 'success' | 'error', RipperServices> = {
  name:    'html:dispatch-page-dag',
  outputs: ['success', 'error'],
  async execute(
    _state:   ScrapeState,
    _context: NodeContextInterface<RipperServices>,
  ): Promise<{ output: 'success' | 'error' }> {
    return { output: 'success' };
  },
};

const failingDispatchNode: NodeInterface<ScrapeState, 'success' | 'error', RipperServices> = {
  name:    'html:dispatch-page-dag',
  outputs: ['success', 'error'],
  async execute(
    _state:   ScrapeState,
    _context: NodeContextInterface<RipperServices>,
  ): Promise<{ output: 'success' | 'error' }> {
    return { output: 'error' };
  },
};

// ── Test helpers ───────────────────────────────────────────────────────────────

const buildRetryPhaseDAG = () => new DAGBuilder(HTML_RETRY_PHASE, '2.0')
  .fanOut(
    'retry-urls',
    succeedingDispatchNode, // placeholder; overridden per test
    'failed',
    { strategy: 'partition', partitions: { success: 'recovered', error: 'failedAfterRetry' } },
    { 'all-success': null, partial: null, 'all-error': null, empty: null },
    { itemKey: 'currentRetryUrl', concurrency: 4 },
  )
  .build();

const buildRetryPhaseDAGFail = () => new DAGBuilder(HTML_RETRY_PHASE, '2.0')
  .fanOut(
    'retry-urls',
    failingDispatchNode,
    'failed',
    { strategy: 'partition', partitions: { success: 'recovered', error: 'failedAfterRetry' } },
    { 'all-success': null, partial: null, 'all-error': null, empty: null },
    { itemKey: 'currentRetryUrl', concurrency: 4 },
  )
  .build();

const makeServices = (dispatcher: Dagonizer<ScrapeState, RipperServices>): RipperServices => ({
  log:        Logger.forComponent('RetryPhase.test'),
  cache:      null,
  target:     { id: 'test', cfg: {} },
  outDir:     '/tmp/retry-phase-test',
  dispatcher,
} as unknown as RipperServices);

describe('htmlRetryPhase', () => {
  it('moves a recovered item from state.failed → state.recovered', async () => {
    const holder: { current: RipperServices | null } = { current: null };
    const dispatcher = new Dagonizer<ScrapeState, RipperServices>({
      services: new Proxy({} as RipperServices, {
        get(_t, prop) {
          if (holder.current === null) throw new Error('services accessed too early');
          return (holder.current as unknown as Record<string | symbol, unknown>)[prop as string];
        },
      }),
    });
    holder.current = makeServices(dispatcher);

    dispatcher.registerNode(succeedingDispatchNode);
    dispatcher.registerDAG(buildRetryPhaseDAG());

    const state = new ScrapeState();
    state.failed = ['https://example.test/page-1'];

    await dispatcher.execute(HTML_RETRY_PHASE, state);

    assert.equal(state.recovered.length, 1, 'one item should be recovered');
    assert.equal(state.recovered[0], 'https://example.test/page-1');
    assert.equal(state.failedAfterRetry.length, 0, 'no items should remain failed after retry');
  });

  it('moves a still-failing item from state.failed → state.failedAfterRetry', async () => {
    const holder: { current: RipperServices | null } = { current: null };
    const dispatcher = new Dagonizer<ScrapeState, RipperServices>({
      services: new Proxy({} as RipperServices, {
        get(_t, prop) {
          if (holder.current === null) throw new Error('services accessed too early');
          return (holder.current as unknown as Record<string | symbol, unknown>)[prop as string];
        },
      }),
    });
    holder.current = makeServices(dispatcher);

    dispatcher.registerNode(failingDispatchNode);
    dispatcher.registerDAG(buildRetryPhaseDAGFail());

    const state = new ScrapeState();
    state.failed = ['https://example.test/page-2'];

    await dispatcher.execute(HTML_RETRY_PHASE, state);

    assert.equal(state.recovered.length, 0, 'no items should be recovered');
    assert.equal(state.failedAfterRetry.length, 1, 'one item should remain failed after retry');
    assert.equal(state.failedAfterRetry[0], 'https://example.test/page-2');
  });

  it('partitions a mixed set across recovered and failedAfterRetry', async () => {
    // Mock node that succeeds for URLs ending in /good and fails for /bad.
    const mixedDispatchNode: NodeInterface<ScrapeState, 'success' | 'error', RipperServices> = {
      name:    'html:dispatch-page-dag',
      outputs: ['success', 'error'],
      async execute(
        state:   ScrapeState,
        _context: NodeContextInterface<RipperServices>,
      ): Promise<{ output: 'success' | 'error' }> {
        const url = state.getMetadata<string>('currentRetryUrl') ?? '';
        return { output: url.endsWith('/good') ? 'success' : 'error' };
      },
    };

    const mixedRetryDAG = new DAGBuilder(HTML_RETRY_PHASE, '2.0')
      .fanOut(
        'retry-urls',
        mixedDispatchNode,
        'failed',
        { strategy: 'partition', partitions: { success: 'recovered', error: 'failedAfterRetry' } },
        { 'all-success': null, partial: null, 'all-error': null, empty: null },
        { itemKey: 'currentRetryUrl', concurrency: 4 },
      )
      .build();

    const holder: { current: RipperServices | null } = { current: null };
    const dispatcher = new Dagonizer<ScrapeState, RipperServices>({
      services: new Proxy({} as RipperServices, {
        get(_t, prop) {
          if (holder.current === null) throw new Error('services accessed too early');
          return (holder.current as unknown as Record<string | symbol, unknown>)[prop as string];
        },
      }),
    });
    holder.current = makeServices(dispatcher);

    dispatcher.registerNode(mixedDispatchNode);
    dispatcher.registerDAG(mixedRetryDAG);

    const state = new ScrapeState();
    state.failed = [
      'https://example.test/a/good',
      'https://example.test/b/bad',
      'https://example.test/c/good',
      'https://example.test/d/bad',
    ];

    await dispatcher.execute(HTML_RETRY_PHASE, state);

    assert.equal(state.recovered.length, 2, 'two good items should be recovered');
    assert.equal(state.failedAfterRetry.length, 2, 'two bad items should remain failed');
    assert.ok(state.recovered.every((u) => u.endsWith('/good')));
    assert.ok(state.failedAfterRetry.every((u) => u.endsWith('/bad')));
  });

  it('is a no-op when state.failed is empty', async () => {
    const holder: { current: RipperServices | null } = { current: null };
    const dispatcher = new Dagonizer<ScrapeState, RipperServices>({
      services: new Proxy({} as RipperServices, {
        get(_t, prop) {
          if (holder.current === null) throw new Error('services accessed too early');
          return (holder.current as unknown as Record<string | symbol, unknown>)[prop as string];
        },
      }),
    });
    holder.current = makeServices(dispatcher);

    dispatcher.registerNode(succeedingDispatchNode);
    dispatcher.registerDAG(buildRetryPhaseDAG());

    const state = new ScrapeState();
    state.failed = [];

    await dispatcher.execute(HTML_RETRY_PHASE, state);

    assert.equal(state.recovered.length, 0);
    assert.equal(state.failedAfterRetry.length, 0);
  });
});
