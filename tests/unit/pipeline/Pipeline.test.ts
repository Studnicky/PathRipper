import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Pipeline } from '../../../src/pipeline/Pipeline.js';

interface State extends Record<string, unknown> {
  log: string[];
}

describe('Pipeline', () => {
  it('returns state unchanged when no tasks are queued', async () => {
    const p = new Pipeline<State>();
    const state: State = { log: [] };
    const result = await p.execute(state);
    assert.deepEqual(result.log, []);
  });

  it('runs a single task that calls next()', async () => {
    const p = new Pipeline<State>();
    p.addTask(async (next, state) => {
      state.log.push('a');
      await next();
    });
    const state: State = { log: [] };
    await p.execute(state);
    assert.deepEqual(state.log, ['a']);
  });

  it('runs queued tasks in declaration order', async () => {
    const p = new Pipeline<State>();
    p.addTasks([
      async (next, state) => { state.log.push('a'); await next(); },
      async (next, state) => { state.log.push('b'); await next(); },
      async (next, state) => { state.log.push('c'); await next(); },
    ]);
    const state: State = { log: [] };
    await p.execute(state);
    assert.deepEqual(state.log, ['a', 'b', 'c']);
  });

  it('halts the chain when a task does NOT call next()', async () => {
    const p = new Pipeline<State>();
    p.addTask(async (_next, state) => { state.log.push('a'); });   // no next()
    p.addTask(async (next,  state) => { state.log.push('b'); await next(); });
    const state: State = { log: [] };
    await p.execute(state);
    assert.deepEqual(state.log, ['a']);
  });

  it('propagates errors thrown from a task', async () => {
    const p = new Pipeline<State>();
    p.addTask(async () => { throw new Error('boom'); });
    await assert.rejects(p.execute({ log: [] }), /boom/);
  });
});
