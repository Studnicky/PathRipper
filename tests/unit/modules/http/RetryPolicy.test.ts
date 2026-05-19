import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { Clock, Scheduler } from '@noocodex/dagonizer/runtime';
import { VirtualClockProvider, VirtualScheduler } from '@noocodex/dagonizer/testing';

import { HttpRetryPolicy } from '../../../../src/modules/http/httpRetryPolicy.js';

/** Flush microtasks so pending Promises register in the VirtualScheduler. */
function tick(): Promise<void> {
  return new Promise<void>((r) => setImmediate(r));
}

function makeError(props: Record<string, unknown>): Error {
  return Object.assign(new Error('boom'), props);
}

describe('HttpRetryPolicy (virtual time)', () => {
  afterEach(() => {
    Scheduler.reset();
    Clock.reset();
  });

  it('resolves immediately on first-attempt success', async () => {
    const sched = new VirtualScheduler(0);
    Scheduler.configure(sched);

    const policy = HttpRetryPolicy.create({ maxAttempts: 3, baseDelayMs: 500 });
    const result = await policy.run(async () => 42);
    assert.equal(result, 42);
    assert.equal(sched.pendingCount, 0);
  });

  it('retries on NETWORK error (ECONNREFUSED) and succeeds on second attempt', async () => {
    const clock = new VirtualClockProvider(0n);
    const sched  = new VirtualScheduler(0);
    Clock.configure(clock);
    Scheduler.configure(sched);

    const policy = HttpRetryPolicy.create({ maxAttempts: 3, baseDelayMs: 500 });
    let calls = 0;

    const runPromise = policy.run(async () => {
      calls++;
      if (calls < 2) throw makeError({ code: 'ECONNREFUSED' });
      return 'ok';
    });

    // Flush microtasks so attempt 1 runs and registers the backoff wait
    await tick();
    assert.equal(sched.pendingCount, 1, 'one pending delay after first failure');

    // Advance scheduler past the DECORRELATED_JITTER delay (base 500ms; range 500–1500ms)
    sched.advance(2000);
    clock.tickMs(2000);

    // Flush so attempt 2 runs
    await tick();

    const result = await runPromise;
    assert.equal(result, 'ok');
    assert.equal(calls, 2);
  });

  it('throws after maxAttempts retryable failures using scheduler.advance', async () => {
    const clock = new VirtualClockProvider(0n);
    const sched  = new VirtualScheduler(0);
    Clock.configure(clock);
    Scheduler.configure(sched);

    const policy = HttpRetryPolicy.create({ maxAttempts: 3, baseDelayMs: 500 });
    let calls = 0;

    const runPromise = policy.run(async () => {
      calls++;
      throw makeError({ code: 'ECONNREFUSED' });
    });
    // Attach an immediate no-op rejection handler so the rejection isn't
    // reported as unhandled while we drive the virtual scheduler below.
    // assert.rejects still observes the rejection through its own await.
    runPromise.catch(() => { /* observed via assert.rejects */ });

    // Drive attempt 1 → wait → attempt 2 → wait → attempt 3 → throw
    // Each tick() flushes microtasks so the next attempt registers its wait;
    // each sched.advance() resolves that wait so the next attempt can start.
    await tick(); sched.advance(2000); clock.tickMs(2000); // attempt 1 done, wait resolved
    await tick(); sched.advance(2000); clock.tickMs(2000); // attempt 2 done, wait resolved
    await tick();                                           // attempt 3 done, no more retries — promise rejects

    await assert.rejects(runPromise);
    assert.equal(calls, 3);
  });

  it('does not retry PERMANENT errors (HTTP 404)', async () => {
    const sched = new VirtualScheduler(0);
    Scheduler.configure(sched);

    const policy = HttpRetryPolicy.create({ maxAttempts: 5, baseDelayMs: 500 });
    let calls = 0;

    await assert.rejects(
      policy.run(async () => {
        calls++;
        throw makeError({ status: 404 });
      }),
    );
    // No scheduler advance needed — permanent errors throw immediately without waiting
    assert.equal(sched.pendingCount, 0, 'no pending delays — permanent errors skip backoff');
    assert.equal(calls, 1);
  });

  it('does not retry VALIDATION errors (TypeError)', async () => {
    const sched = new VirtualScheduler(0);
    Scheduler.configure(sched);

    const policy = HttpRetryPolicy.create({ maxAttempts: 5, baseDelayMs: 500 });
    let calls = 0;

    await assert.rejects(
      policy.run(async () => {
        calls++;
        throw Object.assign(new TypeError('bad input'), {});
      }),
    );
    assert.equal(sched.pendingCount, 0, 'no pending delays — validation errors skip backoff');
    assert.equal(calls, 1);
  });

  it('honors maxAttempts: 1 (no retry on NETWORK error)', async () => {
    const sched = new VirtualScheduler(0);
    Scheduler.configure(sched);

    const policy = HttpRetryPolicy.create({ baseDelayMs: 500, maxAttempts: 1 });
    let calls = 0;

    await assert.rejects(
      policy.run(async () => {
        calls++;
        throw makeError({ code: 'ECONNREFUSED' });
      }),
    );
    assert.equal(calls, 1);
    assert.equal(sched.pendingCount, 0);
  });

  it('honors Retry-After backoff hint on HTTP 429 (THROTTLED)', async () => {
    const clock = new VirtualClockProvider(0n);
    const sched  = new VirtualScheduler(0);
    Clock.configure(clock);
    Scheduler.configure(sched);

    const policy = HttpRetryPolicy.create({ maxAttempts: 3, baseDelayMs: 500 });
    let calls = 0;

    const runPromise = policy.run(async () => {
      calls++;
      if (calls < 2) throw makeError({ status: 429, headers: { 'retry-after': '10' } }); // 10s → 10 000ms
      return 'throttled-ok';
    });

    // Flush so attempt 1 runs and registers the 10 000ms Retry-After wait
    await tick();
    assert.equal(sched.pendingCount, 1, 'one pending delay');

    // Advance past the 10s Retry-After hint
    sched.advance(11_000);
    clock.tickMs(11_000);
    await tick();

    const result = await runPromise;
    assert.equal(result, 'throttled-ok');
    assert.equal(calls, 2);
  });

  it('aborts mid-retry when AbortSignal fires', async () => {
    const sched = new VirtualScheduler(0);
    Scheduler.configure(sched);

    const policy     = HttpRetryPolicy.create({ maxAttempts: 5, baseDelayMs: 500 });
    const controller = new AbortController();
    let calls = 0;

    const runPromise = policy.run(async () => {
      calls++;
      throw makeError({ code: 'ECONNREFUSED' });
    }, controller.signal);

    // Flush so attempt 1 runs and the backoff wait is registered
    await tick();
    assert.equal(sched.pendingCount, 1, 'backoff wait is pending');

    // Abort — the pending wait should reject via the signal listener
    controller.abort(new Error('test abort'));

    await assert.rejects(runPromise);
    assert.equal(calls, 1, 'only one attempt completed before abort');
  });

  it('retries TRANSIENT server errors (HTTP 503)', async () => {
    const clock = new VirtualClockProvider(0n);
    const sched  = new VirtualScheduler(0);
    Clock.configure(clock);
    Scheduler.configure(sched);

    const policy = HttpRetryPolicy.create({ maxAttempts: 3, baseDelayMs: 500 });
    let calls = 0;

    const runPromise = policy.run(async () => {
      calls++;
      if (calls < 2) throw makeError({ status: 503 });
      return 'transient-ok';
    });

    await tick();
    sched.advance(2000);
    clock.tickMs(2000);
    await tick();

    const result = await runPromise;
    assert.equal(result, 'transient-ok');
    assert.equal(calls, 2);
  });

  it('retries TIMEOUT errors (ETIMEDOUT)', async () => {
    const clock = new VirtualClockProvider(0n);
    const sched  = new VirtualScheduler(0);
    Clock.configure(clock);
    Scheduler.configure(sched);

    const policy = HttpRetryPolicy.create({ maxAttempts: 3, baseDelayMs: 500 });
    let calls = 0;

    const runPromise = policy.run(async () => {
      calls++;
      if (calls < 2) throw makeError({ code: 'ETIMEDOUT' });
      return 'timeout-ok';
    });

    await tick();
    sched.advance(2000);
    clock.tickMs(2000);
    await tick();

    const result = await runPromise;
    assert.equal(result, 'timeout-ok');
    assert.equal(calls, 2);
  });
});
