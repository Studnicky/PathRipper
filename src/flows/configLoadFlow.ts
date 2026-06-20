/**
 * configLoadFlow — DAGBuilder-backed config-load flow.
 *
 * Constructs a linear DAG over five nodes that load, parse, validate,
 * normalise, and assert invariants on the ripperoni config file.
 *
 * Chain:
 *   config:read-file → config:parse-json → config:validate-schema
 *     → config:normalize-cache → config:assert-invariants
 *
 * All non-success ports (not-found, error, invalid, invariant-violated)
 * route to the shared `config:failed` terminal. The `config:validate-schema`
 * node emits `valid`/`invalid` (no `success` port); `valid` continues the
 * chain, `invalid` routes to `config:failed`.
 */

import { DAGBuilder } from '@studnicky/dagonizer';
import type { DAGType } from '@studnicky/dagonizer';

import { ReadFileNode }              from '../nodes/config/ReadFileNode.js';
import { ParseJsonNode }             from '../nodes/config/ParseJsonNode.js';
import { ValidateConfigSchemaNode }  from '../nodes/config/ValidateConfigSchemaNode.js';
import { NormalizeCacheNode }        from '../nodes/config/NormalizeCacheNode.js';
import { AssertInvariantsNode }      from '../nodes/config/AssertInvariantsNode.js';

/**
 * Canonical DAG name for the config-load flow.
 * @category Flows
 * @since 4.0.0
 */
export const CONFIG_LOAD_FLOW = 'configLoadDAG';

/**
 * Config-load flow.
 *
 * @category Flows
 * @since 4.0.0
 */
export const configLoadFlow: DAGType = new DAGBuilder(CONFIG_LOAD_FLOW, '2.0')
  .node('config:read-file', ReadFileNode, {
    success:     'config:parse-json',
    'not-found': 'config:failed',
    error:       'config:failed',
  })
  .node('config:parse-json', ParseJsonNode, {
    success: 'config:validate-schema',
    error:   'config:failed',
  })
  .node('config:validate-schema', ValidateConfigSchemaNode, {
    valid:   'config:normalize-cache',
    invalid: 'config:failed',
  })
  .node('config:normalize-cache', NormalizeCacheNode, {
    success:             'config:assert-invariants',
    'invariant-violated': 'config:failed',
  })
  .node('config:assert-invariants', AssertInvariantsNode, {
    success:             'config:completed',
    'invariant-violated': 'config:failed',
  })
  .terminal('config:completed', { outcome: 'completed' })
  .terminal('config:failed',    { outcome: 'failed'    })
  .build();
