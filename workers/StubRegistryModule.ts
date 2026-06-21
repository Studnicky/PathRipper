/**
 * StubRegistryModule — minimal worker registry module for integration testing.
 *
 * Provides a single `stub:echo` node that copies `state.page.url` into
 * `state.output`. No network calls. Used by `tests/integration/worker-container.test.ts`
 * to exercise the WorkerThreadContainer init handshake and scatter dispatch
 * without requiring live HTTP or the full aonprd plugin stack.
 *
 * Compiled to `dist-workers/workers/StubRegistryModule.js` by `tsconfig.workers.json`.
 *
 * @module workers/StubRegistryModule
 * @since 4.2.0
 */

import { DAGBuilder, NodeStateBase }  from '@studnicky/dagonizer';
import type { RegistryModuleInterface, RegistryBundleInterface } from '@studnicky/dagonizer/contracts';
import type { JsonObjectType }        from '@studnicky/dagonizer/entities';
import type { NodeInterface }         from '@studnicky/dagonizer/contracts';
import { Timeout, RoutedBatchBuilder } from '@studnicky/dagonizer';

// ── Stub node interface ─────────────────────────────────────────────────────────
// The worker state carries just the fields the stub node needs.

class StubState extends NodeStateBase {
  page: { url: string } = { url: '' };
  output: Record<string, unknown> | null = null;

  protected override snapshotData(): JsonObjectType {
    return {
      page:   this.page as unknown as JsonObjectType,
      output: this.output as JsonObjectType | null,
    };
  }

  protected override restoreData(snap: JsonObjectType): void {
    const page = snap['page'];
    if (page !== null && typeof page === 'object' && !Array.isArray(page)) {
      this.page = page as unknown as { url: string };
    }
    const out = snap['output'];
    this.output = (out !== null && typeof out === 'object' && !Array.isArray(out))
      ? (out as Record<string, unknown>)
      : null;
  }
}

// ── Stub echo node ──────────────────────────────────────────────────────────────

type StubServicesType = Record<string, never>;

const stubEchoNode: NodeInterface<StubState, string, StubServicesType> = {
  name:    'stub:echo',
  outputs: ['done'],
  // `done` — `state.output` is set to the echoed page url plus a worker marker.
  outputSchema: {
    done: {
      type: 'object',
      properties: {
        output: {
          type: 'object',
          properties: {
            url:              { type: 'string' },
            processedInWorker: { type: 'boolean' },
          },
          required: ['url', 'processedInWorker'],
        },
      },
      required: ['output'],
    },
  },
  timeout: Timeout.none(),
  async execute(batch) {
    for (const { state } of batch) {
      state.output = { url: state.page.url, processedInWorker: true };
    }
    return RoutedBatchBuilder.of('done', batch);
  },
};

// ── Stub DAG ────────────────────────────────────────────────────────────────────
// Named 'test:stub-page' so the coordinator can register the same name for
// validation (via the in-process version using stub:capture), while the worker
// executes THIS version (using stub:echo with processedInWorker: true).

const STUB_DAG = new DAGBuilder('test:stub-page', '1.0')
  .node('stub:echo', stubEchoNode, { done: 'test-stub-page:completed' })
  .terminal('test-stub-page:completed', { outcome: 'completed' })
  .build();

// ── State restore adapter ───────────────────────────────────────────────────────

const stubRestoreAdapter = {
  restore(snapshot: JsonObjectType): StubState {
    return StubState.restore(snapshot);
  },
};

// ── StubRegistryModule ──────────────────────────────────────────────────────────

class StubRegistryModule implements RegistryModuleInterface<StubServicesType> {
  async instantiate(_servicesConfig: JsonObjectType): Promise<RegistryBundleInterface<StubServicesType>> {
    return {
      bundle: {
        nodes: [stubEchoNode as NodeInterface<NodeStateBase, string, unknown>],
        dags:  [STUB_DAG],
      },
      services:        {} as StubServicesType,
      registryVersion: '1.0.0',
      restoreState:    stubRestoreAdapter,
    };
  }
}

export default new StubRegistryModule();
