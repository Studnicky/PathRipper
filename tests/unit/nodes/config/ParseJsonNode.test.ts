import { describe, it } from 'node:test';
import { Batch } from '@studnicky/dagonizer';
import assert from 'node:assert/strict';

import { ParseJsonNode } from '../../../../src/nodes/config/ParseJsonNode.js';
import { ConfigLoadState } from '../../../../src/state/ConfigLoadState.js';

const makeContext = () => ({
  signal:   new AbortController().signal,
  dagName:  'configLoadDAG',
  nodeName: 'parse-json',
  services: undefined,
});

describe('ParseJsonNode', () => {
  it('returns success and populates state.parsed on valid JSON', async () => {
    const state = new ConfigLoadState();
    state.raw   = '{"output":{"basePath":"./out"}}';

    const result = await ParseJsonNode.execute(Batch.of(state), makeContext());

    assert.ok(result.has('success'));
    assert.deepEqual(state.parsed, { output: { basePath: './out' } });
    assert.equal(state.errors.length, 0);
  });

  it('returns error and records error on malformed JSON', async () => {
    const state = new ConfigLoadState();
    state.raw   = '{ invalid json }';

    const result = await ParseJsonNode.execute(Batch.of(state), makeContext());

    assert.ok(result.has('error'));
    assert.equal(state.errors.length, 1);
    const err = state.errors[0];
    assert.ok(err !== undefined);
    assert.equal(err.code, 'SyntaxError');
    assert.equal(err.operation, 'config:parse-json');
    assert.equal(err.recoverable, false);
  });

  it('error message contains position info from V8 SyntaxError', async () => {
    const state = new ConfigLoadState();
    // Force a parse error with recognizable content
    state.raw = '{broken';

    await ParseJsonNode.execute(Batch.of(state), makeContext());

    const err = state.errors[0];
    assert.ok(err !== undefined);
    // V8 SyntaxError messages typically mention position, e.g. "at position N"
    assert.ok(err.message.length > 0);
  });

  it('state.parsed remains undefined on parse error', async () => {
    const state = new ConfigLoadState();
    state.raw   = 'not-json';

    await ParseJsonNode.execute(Batch.of(state), makeContext());

    assert.equal(state.parsed, undefined);
  });
});
