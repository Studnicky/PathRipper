// Unit tests for the html scrape and retry phase DAGs with { dag } scatter body.
//
// Verifies that:
//   • htmlScrapePhase fans out over state.urls, partitions completed items
//     into state.succeeded and failed items into state.failed.
//   • htmlRetryPhase fans out over state.failed, partitions recovered items
//     into state.recovered and still-failing items into state.failedAfterRetry.
//   • Both phases use a { dag } body referencing a registered per-page child DAG.
//   • The child DAG's terminal outcome (completed / failed) drives partition
//     routing — no dispatch wrapper node is involved.
//
// Each phase is dispatched in isolation (independent of the outer composition
// DAG) so the partition mechanics are testable without the full htmlScrapeDAG.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Dagonizer, DAGBuilder } from '@studnicky/dagonizer';

import { ScrapeState }         from '../../../src/state/ScrapeState.js';
import type { RipperServices } from '../../../src/services/RipperServices.js';
import { Logger }              from '../../../src/modules/logger/logger.js';
import {
  buildHtmlScrapePhaseDag,
  buildHtmlRetryPhaseDag,
  HTML_SCRAPE_PHASE,
  HTML_RETRY_PHASE,
} from '../../../src/flows/htmlScrapeDag.js';

// ── Child DAG names ────────────────────────────────────────────────────────────

const SUCCESS_CHILD_DAG = 'test:htmlPage:success';
const FAILING_CHILD_DAG = 'test:htmlPage:fail';
const MIXED_CHILD_DAG   = 'test:htmlPage:mixed';

// ── Per-page child DAGs ────────────────────────────────────────────────────────
// A child DAG that always completes.

const alwaysCompleteChildDag = new DAGBuilder(SUCCESS_CHILD_DAG, '2.0')
  .terminal('done', { outcome: 'completed' })
  .build();

// A child DAG that always fails.
const alwaysFailChildDag = new DAGBuilder(FAILING_CHILD_DAG, '2.0')
  .terminal('done', { outcome: 'failed' })
  .build();

// A child DAG that fails when metadata['currentUrl'] ends with ':fail'.
// Uses a ScalarNode to inspect state metadata and route to the correct terminal.

import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';

class UrlRoutingNodeImpl extends ScalarNode<ScrapeState, 'pass' | 'fail', RipperServices> {
  public readonly name    = 'test:url-router';
  public readonly outputs = ['pass', 'fail'] as const;

  protected override async executeOne(
    state:   ScrapeState,
    _context: NodeContextType<RipperServices>,
  ): Promise<NodeOutputType<'pass' | 'fail'>> {
    const url = state.getMetadata<string>('currentUrl') ?? '';
    return NodeOutputBuilder.of(url.endsWith(':fail') ? 'fail' : 'pass');
  }
}

const UrlRoutingNode = new UrlRoutingNodeImpl();

const mixedChildDag = new DAGBuilder(MIXED_CHILD_DAG, '2.0')
  .node('test:url-router', UrlRoutingNode, { pass: 'page-done', fail: 'page-failed' })
  .terminal('page-done',   { outcome: 'completed' })
  .terminal('page-failed', { outcome: 'failed'    })
  .build();

// ── Phase outcomes ────────────────────────────────────────────────────────────

const PHASE_OUTCOMES: Record<string, string> = {
  'all-success': 'phase-done',
  'partial':     'phase-done',
  'all-error':   'phase-done',
  'empty':       'phase-done',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeServices = (dispatcher: Dagonizer<ScrapeState, RipperServices>): RipperServices => ({
  log:        Logger.forComponent('RetryPhase.test'),
  cache:      null,
  target:     { id: 'test', cfg: {} },
  outDir:     '/tmp/html-scrape-phase-test',
  dispatcher,
} as unknown as RipperServices);

const buildDispatcher = (): {
  dispatcher: Dagonizer<ScrapeState, RipperServices>;
} => {
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
  return { dispatcher };
};

// ── htmlScrapePhase tests ─────────────────────────────────────────────────────

describe('htmlScrapePhase (dag-body scatter)', () => {
  it('routes a completed child DAG item into state.succeeded', async () => {
    const { dispatcher } = buildDispatcher();

    dispatcher.registerNode(UrlRoutingNode);
    dispatcher.registerDAG(alwaysCompleteChildDag);
    dispatcher.registerDAG(buildHtmlScrapePhaseDag(SUCCESS_CHILD_DAG));

    const state = new ScrapeState();
    state.urls  = ['https://example.test/good'];

    await dispatcher.execute(HTML_SCRAPE_PHASE, state);

    assert.equal(state.succeeded.length, 1, 'completed item goes to succeeded');
    assert.equal(state.succeeded[0], 'https://example.test/good');
    assert.equal(state.failed.length, 0, 'no items in failed');
  });

  it('routes a failed child DAG item into state.failed', async () => {
    const { dispatcher } = buildDispatcher();

    dispatcher.registerNode(UrlRoutingNode);
    dispatcher.registerDAG(alwaysFailChildDag);
    dispatcher.registerDAG(buildHtmlScrapePhaseDag(FAILING_CHILD_DAG));

    const state = new ScrapeState();
    state.urls  = ['https://example.test/bad'];

    await dispatcher.execute(HTML_SCRAPE_PHASE, state);

    assert.equal(state.failed.length, 1, 'failed item goes to failed');
    assert.equal(state.failed[0], 'https://example.test/bad');
    assert.equal(state.succeeded.length, 0, 'no items in succeeded');
  });

  it('partitions a mixed set into succeeded and failed', async () => {
    const { dispatcher } = buildDispatcher();

    dispatcher.registerNode(UrlRoutingNode);
    dispatcher.registerDAG(mixedChildDag);
    dispatcher.registerDAG(buildHtmlScrapePhaseDag(MIXED_CHILD_DAG));

    const state = new ScrapeState();
    state.urls  = [
      'https://example.test/alpha',
      'https://example.test/beta:fail',
      'https://example.test/gamma',
      'https://example.test/delta:fail',
    ];

    await dispatcher.execute(HTML_SCRAPE_PHASE, state);

    assert.equal(state.succeeded.length, 2, 'two urls should succeed');
    assert.equal(state.failed.length, 2, 'two urls should fail');
    assert.ok(state.succeeded.every((url) => !url.endsWith(':fail')));
    assert.ok(state.failed.every((url) => url.endsWith(':fail')));
  });

  it('is a no-op when state.urls is empty', async () => {
    const { dispatcher } = buildDispatcher();

    dispatcher.registerNode(UrlRoutingNode);
    dispatcher.registerDAG(alwaysCompleteChildDag);
    dispatcher.registerDAG(buildHtmlScrapePhaseDag(SUCCESS_CHILD_DAG));

    const state = new ScrapeState();
    state.urls  = [];

    await dispatcher.execute(HTML_SCRAPE_PHASE, state);

    assert.equal(state.succeeded.length, 0);
    assert.equal(state.failed.length, 0);
  });
});

// ── htmlRetryPhase tests ──────────────────────────────────────────────────────

describe('htmlRetryPhase (dag-body scatter)', () => {
  it('moves a recovered item from state.failed → state.recovered', async () => {
    const { dispatcher } = buildDispatcher();

    dispatcher.registerNode(UrlRoutingNode);
    dispatcher.registerDAG(alwaysCompleteChildDag);
    dispatcher.registerDAG(buildHtmlRetryPhaseDag(SUCCESS_CHILD_DAG));

    const state  = new ScrapeState();
    state.failed = ['https://example.test/page-1'];

    await dispatcher.execute(HTML_RETRY_PHASE, state);

    assert.equal(state.recovered.length, 1, 'one item should be recovered');
    assert.equal(state.recovered[0], 'https://example.test/page-1');
    assert.equal(state.failedAfterRetry.length, 0, 'no items remain failed after retry');
  });

  it('moves a still-failing item from state.failed → state.failedAfterRetry', async () => {
    const { dispatcher } = buildDispatcher();

    dispatcher.registerNode(UrlRoutingNode);
    dispatcher.registerDAG(alwaysFailChildDag);
    dispatcher.registerDAG(buildHtmlRetryPhaseDag(FAILING_CHILD_DAG));

    const state  = new ScrapeState();
    state.failed = ['https://example.test/page-2'];

    await dispatcher.execute(HTML_RETRY_PHASE, state);

    assert.equal(state.recovered.length, 0, 'no items should be recovered');
    assert.equal(state.failedAfterRetry.length, 1, 'one item remains failed after retry');
    assert.equal(state.failedAfterRetry[0], 'https://example.test/page-2');
  });

  it('partitions a mixed set across recovered and failedAfterRetry', async () => {
    const { dispatcher } = buildDispatcher();

    dispatcher.registerNode(UrlRoutingNode);
    dispatcher.registerDAG(mixedChildDag);
    dispatcher.registerDAG(buildHtmlRetryPhaseDag(MIXED_CHILD_DAG));

    const state  = new ScrapeState();
    state.failed = [
      'https://example.test/alpha',
      'https://example.test/beta:fail',
      'https://example.test/gamma',
      'https://example.test/delta:fail',
    ];

    await dispatcher.execute(HTML_RETRY_PHASE, state);

    assert.equal(state.recovered.length, 2, 'two urls should recover');
    assert.equal(state.failedAfterRetry.length, 2, 'two urls should remain failed');
    assert.ok(state.recovered.every((url) => !url.endsWith(':fail')));
    assert.ok(state.failedAfterRetry.every((url) => url.endsWith(':fail')));
  });

  it('is a no-op when state.failed is empty', async () => {
    const { dispatcher } = buildDispatcher();

    dispatcher.registerNode(UrlRoutingNode);
    dispatcher.registerDAG(alwaysCompleteChildDag);
    dispatcher.registerDAG(buildHtmlRetryPhaseDag(SUCCESS_CHILD_DAG));

    const state  = new ScrapeState();
    state.failed = [];

    await dispatcher.execute(HTML_RETRY_PHASE, state);

    assert.equal(state.recovered.length, 0);
    assert.equal(state.failedAfterRetry.length, 0);
  });
});
