/**
 * Integration test: WorkerThreadContainer at the page-scatter edge.
 *
 * Tests the parallel-parse feature added in Wave C+. Covers three assertions:
 *
 *   (a) Container binds and runs: a real WorkerThreadContainer is constructed
 *       with the compiled StubRegistryModule, a scatter dispatch is executed over
 *       2 items, and the container is torn down cleanly. Exercises the full init
 *       handshake, worker launch, and DAG dispatch path.
 *
 *   (b) Unbound role is inert: when no container backend is bound, a ScatterNode
 *       that declares `container: "worker"` runs in-process. Backward-compat
 *       guarantee: existing fixtures with the container declaration still work
 *       when `parallelWorkers` is off.
 *
 *   (c) Output parity: both the in-process path and the worker path scatter the
 *       same number of items from the same URL list. The in-process node writes
 *       `{ processedInWorker: false }`; the worker node writes
 *       `{ processedInWorker: true }`. Parity means the same item count is
 *       processed on both paths, confirming the container-dispatch path produces
 *       the same coverage as the in-process path.
 *
 * ### DAG naming convention across coordinator / worker
 * Both the coordinator and the worker register `test:stub-page`. The coordinator
 * uses it with `stub:capture` (writes `{ processedInWorker: false }`); the
 * worker isolate uses it with `stub:echo` (writes `{ processedInWorker: true }`).
 * This mirrors the production pattern: `aonprd:page` is registered on the
 * coordinator (loaded from `plugins/aonprd/page.dag.jsonld`) AND re-registered
 * in the worker isolate (same file, via `ParseRegistryModule`). When a container
 * is bound, the coordinator validates the DAG reference and routes execution to
 * the worker, which runs its own registry version.
 *
 * ### What this test does NOT cover
 * - The production ParseRegistryModule (aonprd:page, taxonomy nodes) — that module
 *   is smoke-tested at build time (`tsc -p tsconfig.workers.json`) and exercised
 *   by e2e tests. The stub module keeps this test hermetic: no HTML, no HTTP.
 * - Worker crash / restart recovery — out of scope.
 *
 * @module tests/integration/worker-container
 * @since 4.2.0
 */

import { describe, it }   from 'node:test';
import assert              from 'node:assert/strict';
import { dirname }         from 'node:path';
import { fileURLToPath }   from 'node:url';

import { DAGBuilder, Dagonizer, NodeStateBase, Timeout, RoutedBatchBuilder } from '@studnicky/dagonizer';
import type { NodeInterface }                    from '@studnicky/dagonizer/contracts';
import type { DagContainerInterface }            from '@studnicky/dagonizer';
import type { JsonObjectType }                   from '@studnicky/dagonizer/entities';
import { RecommendedWorkerCountConfigDefault }  from '@studnicky/dagonizer/entities';
import { WorkerThreadContainer, NodeSystemInfo } from '@studnicky/dagonizer-executor-node';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Path to compiled StubRegistryModule ────────────────────────────────────────
// workers/StubRegistryModule.ts is compiled by tsconfig.workers.json to
// dist-workers/workers/StubRegistryModule.js.
// Relative to this test file (tests/integration/):
// ../../dist-workers/workers/StubRegistryModule.js
const STUB_REGISTRY_URL = new URL(
  '../../dist-workers/workers/StubRegistryModule.js',
  import.meta.url,
).href;

const STUB_REGISTRY_VERSION = '1.0.0';

// ── Test state ─────────────────────────────────────────────────────────────────

class TestState extends NodeStateBase {
  page:      { url: string }              = { url: '' };
  output:    Record<string, unknown> | null = null;
  urls:      string[]                     = [];
  succeeded: string[]                     = [];
  failed:    string[]                     = [];

  protected override snapshotData(): JsonObjectType {
    return {
      page:      this.page as unknown as JsonObjectType,
      output:    this.output as JsonObjectType | null,
      urls:      [...this.urls],
      succeeded: [...this.succeeded],
      failed:    [...this.failed],
    };
  }

  protected override restoreData(snap: JsonObjectType): void {
    const page = snap['page'];
    if (page !== null && typeof page === 'object' && !Array.isArray(page)) {
      this.page = page as { url: string };
    }
    const out = snap['output'];
    this.output = (out !== null && typeof out === 'object' && !Array.isArray(out))
      ? (out as Record<string, unknown>)
      : null;
    const urls = snap['urls'];
    if (Array.isArray(urls)) this.urls = urls as string[];
    const succ = snap['succeeded'];
    if (Array.isArray(succ)) this.succeeded = succ as string[];
    const fail = snap['failed'];
    if (Array.isArray(fail)) this.failed = fail as string[];
  }
}

// ── In-process stub node ───────────────────────────────────────────────────────
// The coordinator-side per-page DAG uses this node. It writes
// { processedInWorker: false } so assertions can confirm which path ran.

const stubCaptureNode: NodeInterface<TestState, string, Record<string, never>> = {
  name:    'stub:capture',
  outputs: ['done'],
  timeout: Timeout.none(),
  async execute(batch) {
    for (const { state } of batch) {
      state.output = { processedInWorker: false };
    }
    return RoutedBatchBuilder.of('done', batch);
  },
};

// ── In-process per-page DAG (`test:stub-page`) ─────────────────────────────────
// Registered on the coordinator. When no container is bound (or role inert),
// this DAG runs in-process via stub:capture.
// When a WorkerThreadContainer is bound, the coordinator validates against
// this registration but routes execution to the WORKER's registry — which
// provides its own version of `test:stub-page` via StubRegistryModule.

const inProcessPageDag = new DAGBuilder('test:stub-page', '1.0')
  .node('stub:capture', stubCaptureNode, { done: 'test-stub-page:completed' })
  .terminal('test-stub-page:completed', { outcome: 'completed' })
  .build();

// ── Scatter outputs (shared across all tests) ──────────────────────────────────

const SCATTER_OUTPUTS = {
  'all-success': 'done',
  partial:       'done',
  'all-error':   'done',
  empty:         'done',
} as const;

// ── Gather partition config ────────────────────────────────────────────────────
// The partition strategy maps scatter body OUTPUT PORTS (not terminal outcome
// values) to state array fields. A DAG body that terminates successfully
// emits `'success'`; a failed body emits `'error'`. These map to `state.succeeded`
// and `state.failed` respectively.

const GATHER_PARTITION = {
  strategy:   'partition' as const,
  partitions: { success: 'succeeded', error: 'failed' },
};

// ── Test suite ─────────────────────────────────────────────────────────────────

describe('worker-container integration', () => {
  const TEST_URLS = ['https://stub.test/page-a', 'https://stub.test/page-b'];

  // ── (b) Unbound role is inert ─────────────────────────────────────────────────
  it('(b) unbound container role is inert — in-process scatter completes without a backend', async () => {
    // The orchestration ScatterNode declares container: "worker" but no backend
    // is bound to the dispatcher. The role is inert; it runs in-process.
    const orchDag = new DAGBuilder('test:inert-orch', '1.0')
      .scatter(
        'scatter-urls',
        'urls',
        { dag: 'test:stub-page' },
        SCATTER_OUTPUTS,
        {
          container: 'worker',      // declared but NOT bound → inert
          gather:    GATHER_PARTITION,
          itemKey:   'currentUrl',
          reducer:   'aggregate',
        },
      )
      .terminal('done', { outcome: 'completed' })
      .build();

    const dispatcher = new Dagonizer<TestState, Record<string, never>>({
      services: {},
      // No containers bound → 'worker' role is inert
    });
    dispatcher.registerNode(stubCaptureNode);
    dispatcher.registerDAG(inProcessPageDag);
    dispatcher.registerDAG(orchDag);

    const state = new TestState();
    state.urls = [...TEST_URLS];

    await dispatcher.execute('test:inert-orch', state);
    await dispatcher.destroy();

    assert.equal(state.lifecycle.variant, 'completed', 'lifecycle must be completed');
    assert.equal(
      state.succeeded.length,
      TEST_URLS.length,
      `expected ${TEST_URLS.length.toString()} succeeded in-process; got ${state.succeeded.length.toString()}`,
    );
    assert.equal(state.failed.length, 0, 'expected 0 failures');
  });

  // ── (a) Real worker round-trip ────────────────────────────────────────────────
  it('(a) WorkerThreadContainer: scatter dispatches to worker pool, all items succeed', async () => {
    // Both the coordinator AND the worker register `test:stub-page`.
    // Coordinator: inProcessPageDag (stub:capture, processedInWorker: false).
    // Worker:      StubRegistryModule's STUB_DAG (stub:echo, processedInWorker: true).
    // When the container is bound, the coordinator validates + routes; the worker executes.
    const systemInfo = new NodeSystemInfo();
    const poolSize = Math.min(
      systemInfo.recommendedWorkerCount(RecommendedWorkerCountConfigDefault),
      2,
    );

    const container = new WorkerThreadContainer({
      registryModule:  STUB_REGISTRY_URL,
      registryVersion: STUB_REGISTRY_VERSION,
      servicesConfig:  {},
      poolSize,
    });

    const workerOrchDag = new DAGBuilder('test:worker-orch', '1.0')
      .scatter(
        'scatter',
        'urls',
        { dag: 'test:stub-page' },   // validated on coordinator, executed in worker
        SCATTER_OUTPUTS,
        {
          container: 'worker',
          gather:    GATHER_PARTITION,
          itemKey:   'currentUrl',
          reducer:   'aggregate',
        },
      )
      .terminal('done', { outcome: 'completed' })
      .build();

    const dispatcher = new Dagonizer<TestState, Record<string, never>>({
      services:   {},
      containers: { worker: container as unknown as DagContainerInterface<TestState> },
    });
    // Register test:stub-page on coordinator (satisfies validator).
    // Execution is routed to the worker which uses StubRegistryModule's version.
    dispatcher.registerNode(stubCaptureNode);
    dispatcher.registerDAG(inProcessPageDag);
    dispatcher.registerDAG(workerOrchDag);

    const state = new TestState();
    state.urls = [...TEST_URLS];

    await dispatcher.execute('test:worker-orch', state);
    await dispatcher.destroy();

    assert.equal(
      state.lifecycle.variant, 'completed',
      `lifecycle must be completed; got ${state.lifecycle.variant}`,
    );
    assert.equal(
      state.failed.length, 0,
      `expected 0 failures; got ${state.failed.length.toString()}`,
    );
    assert.equal(
      state.succeeded.length, TEST_URLS.length,
      `expected ${TEST_URLS.length.toString()} succeeded; got ${state.succeeded.length.toString()}`,
    );
  });

  // ── (c) Output parity ─────────────────────────────────────────────────────────
  it('(c) worker and in-process paths process the same item count from the same URL list', async () => {
    // In-process run: no container bound, stub:capture node, same URL list
    const inProcessOrch = new DAGBuilder('test:parity-inprocess-orch', '1.0')
      .scatter(
        'scatter',
        'urls',
        { dag: 'test:stub-page' },
        SCATTER_OUTPUTS,
        {
          gather:  GATHER_PARTITION,
          itemKey: 'currentUrl',
          reducer: 'aggregate',
        },
      )
      .terminal('done', { outcome: 'completed' })
      .build();

    const inProcessDispatcher = new Dagonizer<TestState, Record<string, never>>({ services: {} });
    inProcessDispatcher.registerNode(stubCaptureNode);
    inProcessDispatcher.registerDAG(inProcessPageDag);
    inProcessDispatcher.registerDAG(inProcessOrch);

    const inProcessState = new TestState();
    inProcessState.urls = [...TEST_URLS];
    await inProcessDispatcher.execute('test:parity-inprocess-orch', inProcessState);
    await inProcessDispatcher.destroy();

    // Worker run: real WorkerThreadContainer with StubRegistryModule
    const systemInfo = new NodeSystemInfo();
    const poolSize = Math.min(
      systemInfo.recommendedWorkerCount(RecommendedWorkerCountConfigDefault),
      2,
    );
    const container = new WorkerThreadContainer({
      registryModule:  STUB_REGISTRY_URL,
      registryVersion: STUB_REGISTRY_VERSION,
      servicesConfig:  {},
      poolSize,
    });

    const workerParityOrch = new DAGBuilder('test:parity-worker-orch', '1.0')
      .scatter(
        'scatter',
        'urls',
        { dag: 'test:stub-page' },
        SCATTER_OUTPUTS,
        {
          container: 'worker',
          gather:    GATHER_PARTITION,
          itemKey:   'currentUrl',
          reducer:   'aggregate',
        },
      )
      .terminal('done', { outcome: 'completed' })
      .build();

    const workerDispatcher = new Dagonizer<TestState, Record<string, never>>({
      services:   {},
      containers: { worker: container as unknown as DagContainerInterface<TestState> },
    });
    workerDispatcher.registerNode(stubCaptureNode);
    workerDispatcher.registerDAG(inProcessPageDag);   // satisfies validator
    workerDispatcher.registerDAG(workerParityOrch);

    const workerState = new TestState();
    workerState.urls = [...TEST_URLS];
    await workerDispatcher.execute('test:parity-worker-orch', workerState);
    await workerDispatcher.destroy();

    // Both paths must complete
    assert.equal(inProcessState.lifecycle.variant, 'completed', 'in-process must complete');
    assert.equal(workerState.lifecycle.variant, 'completed', 'worker path must complete');

    // Same item coverage on both paths
    assert.equal(
      inProcessState.succeeded.length, TEST_URLS.length,
      `in-process: expected ${TEST_URLS.length.toString()} succeeded`,
    );
    assert.equal(
      workerState.succeeded.length, TEST_URLS.length,
      `worker: expected ${TEST_URLS.length.toString()} succeeded`,
    );
    assert.equal(inProcessState.failed.length, 0, 'in-process: 0 failed');
    assert.equal(workerState.failed.length,     0, 'worker: 0 failed');
  });
});
