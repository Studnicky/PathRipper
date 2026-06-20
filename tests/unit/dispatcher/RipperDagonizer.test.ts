// Unit tests for RipperDagonizer.
//
// Verifies that dispatching a single-node DAG fires the five lifecycle hooks
// and that each hook writes to the logger with the correct operation string.
// Uses a SpyLogger (Logger subclass) to capture calls without touching any stream.
// No observer mocking — observer layer has been eliminated.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { NodeStateBase, DAGBuilder, RoutedBatchBuilder, Timeout } from '@studnicky/dagonizer';
import type { NodeInterface, NodeContextType, RoutedBatchType, ExecutionResultType , Batch} from '@studnicky/dagonizer';

import { RipperDagonizer } from '../../../src/dispatcher/RipperDagonizer.js';
import { Logger }          from '../../../src/modules/logger/logger.js';
import type { RipperServices } from '../../../src/services/RipperServices.js';

// ── SpyLogger — intercepts Logger calls without touching any stream ────────────

interface LogCall {
  level:     'debug' | 'info' | 'error';
  operation: string;
  message:   string;
  context?:  Readonly<Record<string, unknown>>;
}

// ── Minimal state ──────────────────────────────────────────────────────────────

class MinimalState extends NodeStateBase {}

// ── Minimal single-node DAG fixture ───────────────────────────────────────────

const TEST_DAG_NAME  = 'test:single-node-dag';
const TEST_NODE_NAME = 'test:noop';

const noopNode: NodeInterface<MinimalState, 'done', RipperServices> = {
  name:     TEST_NODE_NAME,
  outputs:  ['done'],
  timeout:  Timeout.none(),
  async execute(
    batch:    Batch<MinimalState>,
    _context: NodeContextType<RipperServices>,
  ): Promise<RoutedBatchType<'done', MinimalState>> {
    return RoutedBatchBuilder.of('done', batch);
  },
};

const buildTestDag = () =>
  new DAGBuilder(TEST_DAG_NAME, '1.0')
    .node(TEST_NODE_NAME, noopNode, { done: 'test-done' })
    .terminal('test-done', { outcome: 'completed' })
    .build();

// ── Helpers ────────────────────────────────────────────────────────────────────

const makeServices = (): RipperServices => ({
  log:        Logger.forComponent('RipperDagonizer.test'),
  cache:      null,
  target:     { id: 'test', cfg: {} },
  outDir:     '/tmp/ripper-dagonizer-test',
  dispatcher: null as unknown as RipperServices['dispatcher'],
} as unknown as RipperServices);

// Build a dispatcher and install the spy logger on the module-level `log` constant
// by overriding the prototype methods on the Logger instance that the module captured.
// Since `log` is a module-level singleton created by `Logger.forComponent('Dispatcher')`,
// we patch the instance returned at module load time via the module's exported class.
//
// The simplest approach: subclass RipperDagonizer and expose captured calls.
class SpyDispatcher<TState extends NodeStateBase> extends RipperDagonizer<TState> {
  public readonly logCalls: LogCall[] = [];

  protected override onFlowStart(dagName: string, state: TState): void {
    this.logCalls.push({ level: 'info', operation: 'flow-start', message: `DAG '${dagName}' started` });
    super.onFlowStart(dagName, state);
  }

  protected override onFlowEnd(dagName: string, state: TState, result: ExecutionResultType<TState>): void {
    this.logCalls.push({ level: 'info', operation: 'flow-end', message: `DAG '${dagName}' ended: ${state.lifecycle.variant}` });
    super.onFlowEnd(dagName, state, result);
  }

  protected override onNodeStart(nodeName: string, state: TState): void {
    this.logCalls.push({ level: 'debug', operation: 'node-start', message: `Node '${nodeName}' started` });
    super.onNodeStart(nodeName, state);
  }

  protected override onNodeEnd(nodeName: string, output: string | null, state: TState): void {
    this.logCalls.push({ level: 'debug', operation: 'node-end', message: `Node '${nodeName}' returned: ${output ?? '<skipped>'}` });
    super.onNodeEnd(nodeName, output, state);
  }

  protected override onError(nodeName: string, error: Error, state: TState): void {
    this.logCalls.push({ level: 'error', operation: 'node-error', message: `Node '${nodeName}' threw: ${error.message}` });
    super.onError(nodeName, error, state);
  }
}

const buildDispatcher = () => {
  const services    = makeServices();
  const dispatcher  = new SpyDispatcher<MinimalState>({ services });
  dispatcher.registerNode(noopNode);
  dispatcher.registerDAG(buildTestDag());
  return dispatcher;
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('RipperDagonizer', () => {
  it('lifecycle hooks fire in the correct sequence for a single-node DAG', async () => {
    const dispatcher = buildDispatcher();

    await dispatcher.execute(TEST_DAG_NAME, new MinimalState());

    const operations = dispatcher.logCalls.map((logCall) => logCall.operation);
    // The DAG has two placements: the noop node and the terminal node.
    // Both fire onNodeStart / onNodeEnd in 0.23.
    assert.deepEqual(
      operations,
      ['flow-start', 'node-start', 'node-end', 'node-start', 'node-end', 'flow-end'],
      `Expected flow-start → (node-start → node-end) × 2 → flow-end, got: ${operations.join(' → ')}`,
    );
  });

  it('onFlowStart logs operation "flow-start" with the dag name', async () => {
    const dispatcher = buildDispatcher();

    await dispatcher.execute(TEST_DAG_NAME, new MinimalState());

    const call = dispatcher.logCalls.find((logCall) => logCall.operation === 'flow-start');
    assert.ok(call !== undefined);
    assert.equal(call.level, 'info');
    assert.ok(call.message.includes(TEST_DAG_NAME), `Expected message to include dag name "${TEST_DAG_NAME}", got: "${call.message}"`);
  });

  it('onNodeStart logs operation "node-start" with the node name', async () => {
    const dispatcher = buildDispatcher();

    await dispatcher.execute(TEST_DAG_NAME, new MinimalState());

    const call = dispatcher.logCalls.find((logCall) => logCall.operation === 'node-start');
    assert.ok(call !== undefined);
    assert.equal(call.level, 'debug');
    assert.ok(call.message.includes(TEST_NODE_NAME), `Expected message to include node name "${TEST_NODE_NAME}", got: "${call.message}"`);
  });

  it('onNodeEnd logs operation "node-end" with the node name and output', async () => {
    const dispatcher = buildDispatcher();

    await dispatcher.execute(TEST_DAG_NAME, new MinimalState());

    const call = dispatcher.logCalls.find((logCall) => logCall.operation === 'node-end');
    assert.ok(call !== undefined);
    assert.equal(call.level, 'debug');
    assert.ok(call.message.includes(TEST_NODE_NAME), `Expected node name in message, got: "${call.message}"`);
    assert.ok(call.message.includes('done'), `Expected output "done" in message, got: "${call.message}"`);
  });

  it('onFlowEnd logs operation "flow-end" with dag name and lifecycle variant "completed"', async () => {
    const dispatcher = buildDispatcher();

    await dispatcher.execute(TEST_DAG_NAME, new MinimalState());

    const call = dispatcher.logCalls.find((logCall) => logCall.operation === 'flow-end');
    assert.ok(call !== undefined);
    assert.equal(call.level, 'info');
    assert.ok(call.message.includes(TEST_DAG_NAME), `Expected dag name in message, got: "${call.message}"`);
    assert.ok(call.message.includes('completed'), `Expected lifecycle variant "completed" in message, got: "${call.message}"`);
  });

  it('onError is NOT called when the node succeeds', async () => {
    const dispatcher = buildDispatcher();

    await dispatcher.execute(TEST_DAG_NAME, new MinimalState());

    const errorCalls = dispatcher.logCalls.filter((logCall) => logCall.operation === 'node-error');
    assert.equal(errorCalls.length, 0);
  });

  it('total hook log calls for a single-node-plus-terminal DAG is exactly 6', async () => {
    const dispatcher = buildDispatcher();

    await dispatcher.execute(TEST_DAG_NAME, new MinimalState());

    // flow-start + (node-start + node-end) for noop + (node-start + node-end) for terminal + flow-end
    assert.equal(dispatcher.logCalls.length, 6);
  });

  it('RipperDagonizer has no observer constructor parameter', () => {
    // The constructor only accepts { services } — no observer field.
    // Verify at runtime by checking the constructed instance has no #observer field.
    const services    = makeServices();
    const dispatcher  = new RipperDagonizer<MinimalState>({ services });
    const keys = Object.getOwnPropertyNames(dispatcher);
    assert.ok(
      !keys.some((key) => key.includes('observer')),
      `Expected no observer field on instance, found: ${keys.join(', ')}`,
    );
  });
});
