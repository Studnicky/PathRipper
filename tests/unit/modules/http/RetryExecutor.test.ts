import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { RetryExecutor } from '../../../../src/modules/http/RetryExecutor.js';

function makeError(props: Record<string, unknown>): Error {
  return Object.assign(new Error('boom'), props);
}

describe('RetryExecutor', () => {
  it('returns the value on first-attempt success', async () => {
    const r = new RetryExecutor({ baseDelayMs: 1 });
    const result = await r.execute(async () => 42);
    assert.equal(result, 42);
  });

  it('retries on a retryable error and succeeds on second attempt', async () => {
    const r = new RetryExecutor({ baseDelayMs: 1, maxAttempts: 3 });
    let calls = 0;
    const result = await r.execute(async () => {
      calls++;
      if (calls < 2) throw makeError({ code: 'ECONNREFUSED' });
      return 'ok';
    });
    assert.equal(result, 'ok');
    assert.equal(calls, 2);
  });

  it('throws after maxAttempts retryable failures', async () => {
    const r = new RetryExecutor({ baseDelayMs: 1, maxAttempts: 3 });
    let calls = 0;
    await assert.rejects(
      r.execute(async () => {
        calls++;
        throw makeError({ code: 'ECONNREFUSED' });
      }),
    );
    assert.equal(calls, 3);
  });

  it('does not retry non-retryable errors', async () => {
    const r = new RetryExecutor({ baseDelayMs: 1, maxAttempts: 5 });
    let calls = 0;
    await assert.rejects(
      r.execute(async () => {
        calls++;
        throw makeError({ status: 404 });
      }),
    );
    assert.equal(calls, 1);
  });

  it('honors maxAttempts: 1 (no retry)', async () => {
    const r = new RetryExecutor({ baseDelayMs: 1, maxAttempts: 1 });
    let calls = 0;
    await assert.rejects(
      r.execute(async () => {
        calls++;
        throw makeError({ code: 'ECONNREFUSED' });
      }),
    );
    assert.equal(calls, 1);
  });
});
