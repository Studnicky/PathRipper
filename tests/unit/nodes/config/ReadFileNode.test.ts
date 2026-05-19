import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ReadFileNode } from '../../../../src/nodes/config/ReadFileNode.js';
import { ConfigLoadState } from '../../../../src/state/ConfigLoadState.js';

let tmpDir = '';

const makeContext = () => ({
  signal:   new AbortController().signal,
  dagName:  'configLoadDAG',
  nodeName: 'read-file',
  services: undefined,
});

describe('ReadFileNode', () => {
  before(async () => { tmpDir = await mkdtemp(join(tmpdir(), 'ripper-read-')); });
  after(async ()  => { await rm(tmpDir, { recursive: true, force: true }); });

  it('returns success and populates state.raw when the file exists', async () => {
    const filePath = join(tmpDir, 'valid.json');
    await writeFile(filePath, '{"a":1}', 'utf-8');

    const state = new ConfigLoadState();
    state.path  = filePath;

    const result = await ReadFileNode.execute(state, makeContext());

    assert.equal(result.output, 'success');
    assert.equal(state.raw, '{"a":1}');
    assert.equal(state.errors.length, 0);
  });

  it('returns not-found when the file does not exist', async () => {
    const state = new ConfigLoadState();
    state.path  = join(tmpDir, 'does-not-exist.json');

    const result = await ReadFileNode.execute(state, makeContext());

    assert.equal(result.output, 'not-found');
    assert.equal(state.errors.length, 1);
    assert.ok(state.errors[0]?.message.length ?? 0 > 0);
    assert.equal(state.raw, '');
  });

  it('records an error on not-found', async () => {
    const state = new ConfigLoadState();
    state.path  = join(tmpDir, 'no-file.json');

    await ReadFileNode.execute(state, makeContext());

    const err = state.errors[0];
    assert.ok(err !== undefined);
    assert.equal(err.operation, 'config:read-file');
    assert.equal(err.recoverable, false);
  });
});
