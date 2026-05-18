import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { TaskRegistry } from '../../../src/registry/TaskRegistry.js';
import type { HookFnInterface } from '../../../src/registry/TaskRegistry.js';
import type { PipelineContextInterface } from '../../../src/types/PipelineState.js';

const noopHook: HookFnInterface = (_ctx: PipelineContextInterface): void => { /* noop */ };

describe('TaskRegistry — lifecycle hooks', () => {
  afterEach(() => { TaskRegistry.reset(); });

  it('registerHook stores onRunStart hooks in registration order', () => {
    TaskRegistry.registerHook('context:logger',  'onRunStart', noopHook);
    TaskRegistry.registerHook('context:ajv',     'onRunStart', noopHook);
    TaskRegistry.registerHook('context:dataset', 'onRunStart', noopHook);

    const hooks = TaskRegistry.onRunStartHooks();
    assert.deepEqual(hooks.map(([n]) => n), [
      'context:logger',
      'context:ajv',
      'context:dataset',
    ]);
  });

  it('registerHook stores onRunEnd hooks separately from onRunStart', () => {
    TaskRegistry.registerHook('context:logger', 'onRunStart', noopHook);
    TaskRegistry.registerHook('finalize:drain', 'onRunEnd',   noopHook);

    assert.equal(TaskRegistry.onRunStartHooks().length, 1);
    assert.equal(TaskRegistry.onRunEndHooks().length,   1);
    assert.equal(TaskRegistry.onRunStartHooks()[0]?.[0], 'context:logger');
    assert.equal(TaskRegistry.onRunEndHooks()[0]?.[0],   'finalize:drain');
  });

  it('registerHook overwrites the existing hook silently when called twice with the same name', () => {
    let called = '';
    const hookA: HookFnInterface = () => { called = 'A'; };
    const hookB: HookFnInterface = () => { called = 'B'; };

    TaskRegistry.registerHook('context:logger', 'onRunStart', hookA);
    TaskRegistry.registerHook('context:logger', 'onRunStart', hookB);

    const hooks = TaskRegistry.onRunStartHooks();
    assert.equal(hooks.length, 1);
    hooks[0]?.[1]({} as PipelineContextInterface);
    assert.equal(called, 'B');
  });

  it('manifests() returns one entry per registered task and hook in registration order', () => {
    TaskRegistry.registerHook('context:logger', 'onRunStart', noopHook);
    TaskRegistry.register(
      'classify:rules',
      async (next, _state) => { await next(); },
      { proposesClass: true },
    );
    TaskRegistry.registerHook('finalize:drain', 'onRunEnd', noopHook);

    const manifests = TaskRegistry.manifests();
    assert.equal(manifests.length, 3);
    assert.equal(manifests[0]?.name,  'context:logger');
    assert.equal(manifests[0]?.phase, 'onRunStart');
    assert.equal(manifests[1]?.name,  'classify:rules');
    assert.equal(manifests[1]?.proposesClass, true);
    assert.equal(manifests[1]?.phase, undefined);
    assert.equal(manifests[2]?.name,  'finalize:drain');
    assert.equal(manifests[2]?.phase, 'onRunEnd');
  });

  it('manifests() omits proposesClass when not declared at registration', () => {
    TaskRegistry.register('json:read', async (next, _state) => { await next(); });
    const m = TaskRegistry.manifests();
    assert.equal(m.length, 1);
    assert.equal(m[0]?.proposesClass, undefined);
  });

  it('reset() clears tasks, hooks, and manifests', () => {
    TaskRegistry.register('classify:rules', async (next, _state) => { await next(); });
    TaskRegistry.registerHook('context:logger', 'onRunStart', noopHook);
    TaskRegistry.registerHook('finalize:drain', 'onRunEnd',   noopHook);

    TaskRegistry.reset();

    assert.equal(TaskRegistry.has('classify:rules'),    false);
    assert.equal(TaskRegistry.onRunStartHooks().length, 0);
    assert.equal(TaskRegistry.onRunEndHooks().length,   0);
    assert.equal(TaskRegistry.manifests().length,       0);
  });

  it('instance hooks are isolated from the static default registry', () => {
    const instance = new TaskRegistry();
    instance.registerHook('context:logger', 'onRunStart', noopHook);

    assert.equal(instance.onRunStartHooks().length,        1);
    assert.equal(TaskRegistry.onRunStartHooks().length,    0);
  });
});
