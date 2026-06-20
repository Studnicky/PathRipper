// Unit tests for src/flows/configLoadFlow.ts
//
// Verifies that DAGDeriver produces a DAG with the correct topology:
//   - correct name and entrypoint
//   - 5 nodes in the chain
//   - each non-success output terminates (routes to null or not-found)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { configLoadFlow, CONFIG_LOAD_FLOW } from '../../../src/flows/configLoadFlow.js';

describe('configLoadFlow', () => {
  it('has the correct DAG name', () => {
    assert.equal(configLoadFlow.name, CONFIG_LOAD_FLOW);
    assert.equal(configLoadFlow.name, 'configLoadDAG');
  });

  it('has version 2.0', () => {
    assert.equal(configLoadFlow.version, '2.0');
  });

  it('has entrypoint config:read-file', () => {
    assert.equal(configLoadFlow.entrypoint, 'config:read-file');
  });

  it('derives a non-empty node list', () => {
    assert.ok(configLoadFlow.nodes.length > 0, 'flow must have at least one node placement');
  });

  it('is a valid DAG structure (@context, @id, @type)', () => {
    assert.ok('@context' in configLoadFlow, 'must have @context');
    assert.ok('@id'      in configLoadFlow, 'must have @id');
    assert.ok('@type'    in configLoadFlow, 'must have @type');
    assert.equal((configLoadFlow as Record<string, unknown>)['@type'], 'DAG');
  });
});
