import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ValidateConfigSchemaNode } from '../../../../src/nodes/config/ValidateConfigSchemaNode.js';
import { ConfigLoadState } from '../../../../src/state/ConfigLoadState.js';

const makeContext = () => ({
  signal:   new AbortController().signal,
  dagName:  'configLoadDAG',
  nodeName: 'validate-schema',
  services: undefined,
});

describe('ValidateConfigSchemaNode', () => {
  it('returns valid and populates state.validated on a schema-conforming object', async () => {
    const state = new ConfigLoadState();
    state.parsed = { output: { basePath: './out' } };

    const result = await ValidateConfigSchemaNode.execute(state, makeContext());

    assert.equal(result.output, 'valid');
    assert.deepEqual(state.validated, { output: { basePath: './out' } });
    assert.equal(state.errors.length, 0);
  });

  it('returns invalid when required field is missing', async () => {
    const state = new ConfigLoadState();
    state.parsed = {}; // missing `output`

    const result = await ValidateConfigSchemaNode.execute(state, makeContext());

    assert.equal(result.output, 'invalid');
    assert.equal(state.validated, null);
    assert.equal(state.errors.length, 1);
  });

  it('records AJV errors on invalid schema', async () => {
    const state = new ConfigLoadState();
    state.parsed = { output: { basePath: './out' }, mystery: 1 }; // additionalProperties

    await ValidateConfigSchemaNode.execute(state, makeContext());

    const err = state.errors[0];
    assert.ok(err !== undefined);
    assert.equal(err.code, 'SCHEMA_INVALID');
    assert.equal(err.operation, 'config:validate-schema');
    assert.ok(err.message.includes('additional'));
  });

  it('returns invalid for bad URI in mediawiki.apiUrl', async () => {
    const state = new ConfigLoadState();
    state.parsed = {
      output:    { basePath: './out' },
      mediawiki: { x: { apiUrl: 'not-a-url', pipeline: ['wiki:fetch'] } },
    };

    const result = await ValidateConfigSchemaNode.execute(state, makeContext());

    assert.equal(result.output, 'invalid');
    const err = state.errors[0];
    assert.ok(err !== undefined);
    assert.ok(err.message.includes('uri'));
  });
});
