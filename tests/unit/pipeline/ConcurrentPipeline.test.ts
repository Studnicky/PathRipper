import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Pipeline } from '../../../src/pipeline/Pipeline.js';
import { ConcurrentPipeline } from '../../../src/pipeline/ConcurrentPipeline.js';

type S = { value: number; done: boolean };

function makeState(value: number): S { return { value, done: false }; }

describe('ConcurrentPipeline', () => {
  it('executes all states and returns them in completed', async () => {
    const pipeline = Pipeline.create<S>({ name: 'test' });
    pipeline.addTask(async (next, s) => { s.done = true; await next(); });

    const runner = ConcurrentPipeline.create(pipeline, 4, { name: 'test' });
    const states = [1, 2, 3, 4, 5].map(makeState);
    const { completed, failed } = await runner.executeAll(states);

    assert.equal(completed.length, 5);
    assert.equal(failed.length, 0);
    assert.ok(completed.every((s: S) => s.done));
  });

  it('collects failures without aborting other executions', async () => {
    const pipeline = Pipeline.create<S>({ name: 'test' });
    pipeline.addTask(async (next, s) => {
      if (s.value === 3) throw new Error('bad page');
      s.done = true;
      await next();
    });

    const runner = ConcurrentPipeline.create(pipeline, 2, { name: 'test' });
    const states = [1, 2, 3, 4, 5].map(makeState);
    const { completed, failed } = await runner.executeAll(states);

    assert.equal(completed.length, 4);
    assert.equal(failed.length, 1);
    assert.equal((failed[0]!.error as Error).message, 'bad page');
    assert.equal((failed[0]!.state as S).value, 3);
  });

  it('respects concurrency ceiling — concurrent count never exceeds limit', async () => {
    let active = 0;
    let maxActive = 0;
    const limit = 3;

    const pipeline = Pipeline.create<S>({ name: 'test' });
    pipeline.addTask(async (next, s) => {
      active++;
      maxActive = Math.max(maxActive, active);
      // Yield to event loop so concurrent tasks can interleave
      await new Promise<void>(r => setImmediate(r));
      s.done = true;
      active--;
      await next();
    });

    const runner = ConcurrentPipeline.create(pipeline, limit, { name: 'test' });
    const states = Array.from({ length: 10 }, (_, i) => makeState(i));
    const { completed } = await runner.executeAll(states);

    assert.equal(completed.length, 10);
    assert.ok(maxActive <= limit, `maxActive ${maxActive.toString()} exceeded limit ${limit.toString()}`);
  });

  it('concurrency=1 is equivalent to sequential execution', async () => {
    const order: number[] = [];
    const pipeline = Pipeline.create<S>({ name: 'test' });
    pipeline.addTask(async (next, s) => { order.push(s.value); await next(); });

    const runner = ConcurrentPipeline.create(pipeline, 1, { name: 'seq' });
    const states = [1, 2, 3].map(makeState);
    await runner.executeAll(states);

    assert.deepEqual(order, [1, 2, 3]);
  });

  it('empty input resolves immediately with empty arrays', async () => {
    const pipeline = Pipeline.create<S>({ name: 'test' });
    const runner = ConcurrentPipeline.create(pipeline, 4, { name: 'test' });
    const { completed, failed } = await runner.executeAll([]);
    assert.equal(completed.length, 0);
    assert.equal(failed.length, 0);
  });

  it('shared pipeline instance is safe across concurrent executions', async () => {
    // All concurrent executions share the same Pipeline — verify no cross-contamination
    const pipeline = Pipeline.create<S>({ name: 'shared' });
    pipeline.addTask(async (next, s) => {
      await new Promise<void>(r => setImmediate(r));
      s.value = s.value * 2;
      await next();
    });

    const runner = ConcurrentPipeline.create(pipeline, 8, { name: 'shared' });
    const states = [1, 2, 3, 4, 5, 6, 7, 8].map(makeState);
    const { completed } = await runner.executeAll(states);

    const values = completed.map((s: S) => s.value).sort((a, b) => a - b);
    assert.deepEqual(values, [2, 4, 6, 8, 10, 12, 14, 16]);
  });
});
