import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TaskRegistry } from '../../../src/registry/TaskRegistry.js';
import { MappingError } from '../../../src/errors/MappingError.js';
import { ExternalSchemaError } from '../../../src/errors/ExternalSchemaError.js';

describe('TaskRegistry', () => {
  afterEach(() => { TaskRegistry.reset(); });

  it('register() adds a task; has() returns true; get() returns it', () => {
    const task = async (_next: () => Promise<void>, _state: Record<string, unknown>): Promise<void> => { /* noop */ };
    TaskRegistry.register('myTask', task);
    assert.equal(TaskRegistry.has('myTask'), true);
    assert.equal(TaskRegistry.get('myTask'), task);
  });

  it('register() same name twice throws MappingError', () => {
    const task = async (_next: () => Promise<void>, _state: Record<string, unknown>): Promise<void> => { /* noop */ };
    TaskRegistry.register('dupTask', task);
    assert.throws(
      () => TaskRegistry.register('dupTask', task),
      (err: unknown) => err instanceof MappingError && /already registered/.test(err.message),
    );
  });

  it('get() unknown name returns undefined', () => {
    assert.equal(TaskRegistry.get('unknownTask'), undefined);
  });

  it('reset() clears all registrations', () => {
    const task = async (_next: () => Promise<void>, _state: Record<string, unknown>): Promise<void> => { /* noop */ };
    TaskRegistry.register('toBeCleared', task);
    assert.equal(TaskRegistry.has('toBeCleared'), true);
    TaskRegistry.reset();
    assert.equal(TaskRegistry.has('toBeCleared'), false);
  });

  it('loadAll([]) resolves without error', async () => {
    await assert.doesNotReject(TaskRegistry.loadAll([]));
  });

  it('load() with a nonexistent path throws ExternalSchemaError', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'ripperoni-registry-'));
    try {
      await assert.rejects(
        TaskRegistry.load('does-not-exist-plugin.js', tmpDir),
        (err: unknown) => err instanceof ExternalSchemaError,
      );
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('load() imports a plugin file that registers a task as side-effect', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'ripperoni-registry-'));
    try {
      const pluginContent = `
        import { TaskRegistry } from '${join(process.cwd(), 'src/registry/TaskRegistry.js')}';
        TaskRegistry.register('sideEffectTask', async () => {});
      `;
      const pluginPath = join(tmpDir, 'test-plugin.mjs');
      await writeFile(pluginPath, pluginContent);
      await TaskRegistry.load(pluginPath, tmpDir);
      assert.equal(TaskRegistry.has('sideEffectTask'), true);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
