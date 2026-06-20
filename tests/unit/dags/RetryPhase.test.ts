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
// Phase DAGs are constructed via DAGBuilder matching how runHtml/runWiki
// builds them at runtime.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Dagonizer, DAGBuilder, RoutedBatchBuilder, EMPTY_CONTRACT_FRAGMENT, Timeout } from '@studnicky/dagonizer';
import type { NodeInterface, NodeContextType, RoutedBatchType , Batch} from '@studnicky/dagonizer';

import { ScrapeState }       from '../../../src/state/ScrapeState.js';
import type { RipperServices }  from '../../../src/services/RipperServices.js';
import { Logger }            from '../../../src/modules/logger/logger.js';

const HTML_RETRY_PHASE = 'htmlRetryPhase';

// ── Mock dispatch nodes ────────────────────────────────────────────────────────

const PHASE_OUTCOMES: Record<string, string> = {
  'all-success': 'phase-done',
  'partial':     'phase-done',
  'all-error':   'phase-done',
  'empty':       'phase-done',
};

const succeedingDispatchNode: NodeInterface<ScrapeState, 'success' | 'error', RipperServices> = {
  name:     'html:dispatch-page-dag',
  outputs:  ['success', 'error'],
  timeout:  Timeout.none(),
  contract: EMPTY_CONTRACT_FRAGMENT,
  async execute(
    batch:    Batch<ScrapeState>,
    _context: NodeContextType<RipperServices>,
  ): Promise<RoutedBatchType<'success' | 'error', ScrapeState>> {
    return RoutedBatchBuilder.of('success', batch);
  },
};

const failingDispatchNode: NodeInterface<ScrapeState, 'success' | 'error', RipperServices> = {
  name:     'html:dispatch-page-dag',
  outputs:  ['success', 'error'],
  timeout:  Timeout.none(),
  contract: EMPTY_CONTRACT_FRAGMENT,
  async execute(
    batch:    Batch<ScrapeState>,
    _context: NodeContextType<RipperServices>,
  ): Promise<RoutedBatchType<'success' | 'error', ScrapeState>> {
    return RoutedBatchBuilder.of('error', batch);
  },
};

// ── Test helpers ───────────────────────────────────────────────────────────────

const buildRetryPhaseDAG = () =>
  new DAGBuilder(HTML_RETRY_PHASE, '2.0')
    .scatter('retry-urls', 'failed', succeedingDispatchNode, PHASE_OUTCOMES, {
      itemKey:     'currentRetryUrl',
      concurrency: 4,
      gather:      { strategy: 'partition', partitions: { success: 'recovered', error: 'failedAfterRetry' } },
    })
    .terminal('phase-done', { outcome: 'completed' })
    .build();

const buildRetryPhaseDAGFail = () =>
  new DAGBuilder(HTML_RETRY_PHASE, '2.0')
    .scatter('retry-urls', 'failed', failingDispatchNode, PHASE_OUTCOMES, {
      itemKey:     'currentRetryUrl',
      concurrency: 4,
      gather:      { strategy: 'partition', partitions: { success: 'recovered', error: 'failedAfterRetry' } },
    })
    .terminal('phase-done', { outcome: 'completed' })
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
        get(_tgt, prop) {
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
        get(_tgt, prop) {
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
      name:     'html:dispatch-page-dag',
      outputs:  ['success', 'error'],
      timeout:  Timeout.none(),
      contract: EMPTY_CONTRACT_FRAGMENT,
      async execute(
        batch:    Batch<ScrapeState>,
        _context: NodeContextType<RipperServices>,
      ): Promise<RoutedBatchType<'success' | 'error', ScrapeState>> {
        return batch.partition((state) => {
          const url = state.getMetadata<string>('currentRetryUrl') ?? '';
          return url.endsWith('/good') ? 'success' : 'error';
        });
      },
    };

    const mixedRetryDAG = new DAGBuilder(HTML_RETRY_PHASE, '2.0')
      .scatter('retry-urls', 'failed', mixedDispatchNode, PHASE_OUTCOMES, {
        itemKey:     'currentRetryUrl',
        concurrency: 4,
        gather:      { strategy: 'partition', partitions: { success: 'recovered', error: 'failedAfterRetry' } },
      })
      .terminal('phase-done', { outcome: 'completed' })
      .build();

    const holder: { current: RipperServices | null } = { current: null };
    const dispatcher = new Dagonizer<ScrapeState, RipperServices>({
      services: new Proxy({} as RipperServices, {
        get(_tgt, prop) {
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
    assert.ok(state.recovered.every((url) => url.endsWith('/good')));
    assert.ok(state.failedAfterRetry.every((url) => url.endsWith('/bad')));
  });

  it('is a no-op when state.failed is empty', async () => {
    const holder: { current: RipperServices | null } = { current: null };
    const dispatcher = new Dagonizer<ScrapeState, RipperServices>({
      services: new Proxy({} as RipperServices, {
        get(_tgt, prop) {
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
