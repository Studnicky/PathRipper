// Unit tests for src/flows/stub.ts
//
// Verifies that `stub(name, outputs)` returns a well-formed stub object:
//   - correct `name`
//   - correct `outputs`
//   - `execute()` throws with a message naming the stub

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { stub } from '../../../src/flows/stub.js';

describe('stub()', () => {
  it('returns an object with the provided name', () => {
    const node = stub('my:node', ['success', 'error'] as const);
    assert.equal(node.name, 'my:node');
  });

  it('returns an object with the provided outputs', () => {
    const node = stub('my:node', ['success', 'error', 'cached'] as const);
    assert.deepEqual(node.outputs, ['success', 'error', 'cached']);
  });

  it('execute() throws an error mentioning the stub name', async () => {
    const node = stub('test:stub', ['ok'] as const);

    await assert.rejects(
      async () => { await node.execute({} as never, {} as never); },
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(
          err.message.includes('test:stub'),
          `Expected error to mention 'test:stub', got: ${err.message}`,
        );
        return true;
      },
    );
  });

  it('execute() throws an error containing "stub"', async () => {
    const node = stub('foo:bar', ['done'] as const);

    await assert.rejects(
      async () => { await node.execute({} as never, {} as never); },
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(
          err.message.toLowerCase().includes('stub'),
          `Expected error to mention 'stub', got: ${err.message}`,
        );
        return true;
      },
    );
  });

  it('each call returns a distinct object', () => {
    const a = stub('n', ['ok'] as const);
    const b = stub('n', ['ok'] as const);
    assert.notEqual(a, b, 'stub() must return a new object each invocation');
  });

  it('single-output stubs have a single-element outputs array', () => {
    const node = stub('single:node', ['success'] as const);
    assert.equal(node.outputs.length, 1);
    assert.equal(node.outputs[0], 'success');
  });
});
