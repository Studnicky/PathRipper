/**
 * configLoadFlow — contract-derived config-load flow.
 *
 * Uses FlowDeriver with `annotations.terminals` for all non-`success` output
 * ports. FlowDeriver is sufficient here because:
 *
 *   - The five nodes form a strict linear data chain via `produces ↔ hardRequired`
 *     matching: `path → raw → parsed → validated → normalized`.
 *   - All non-`success` outputs (`not-found`, `error`, `invalid`,
 *     `invariant-violated`) terminate the flow → `target: null`.
 *   - `config:validate-schema` emits `valid`/`invalid` instead of `success`/`error`.
 *     Both are declared in `terminals`: `valid` re-routes to the auto-derived next
 *     node (`config:normalize-cache`), `invalid` terminates. FlowDeriver still
 *     auto-wires `success → config:normalize-cache` from the data graph — this
 *     dead route is harmless since the node never emits `success`.
 *
 * Chain: config:read-file → config:parse-json → config:validate-schema
 *           → config:normalize-cache → config:assert-invariants
 */

import { FlowDeriver } from '@noocodex/dagonizer/derive';
import type { DAG }    from '@noocodex/dagonizer';
import type { OperationContract } from '@noocodex/dagonizer/contracts';

import { readFileContract }              from '../nodes/config/ReadFileNode.js';
import { parseJsonContract }             from '../nodes/config/ParseJsonNode.js';
import { validateConfigSchemaContract }  from '../nodes/config/ValidateConfigSchemaNode.js';
import { normalizeCacheContract }        from '../nodes/config/NormalizeCacheNode.js';
import { assertInvariantsContract }      from '../nodes/config/AssertInvariantsNode.js';

/**
 * Canonical DAG name for the config-load flow.
 * @category Flows
 * @since 4.0.0
 */
export const CONFIG_LOAD_FLOW = 'configLoadDAG';

const configContracts: readonly OperationContract[] = [
  readFileContract,
  parseJsonContract,
  validateConfigSchemaContract,
  normalizeCacheContract,
  assertInvariantsContract,
];

/**
 * Config-load flow.
 *
 * @category Flows
 * @since 4.0.0
 */
export const configLoadFlow: DAG = FlowDeriver.derive({
  name:       CONFIG_LOAD_FLOW,
  version:    '2.0',
  entrypoint: 'config:read-file',
  contracts:  configContracts,
  annotations: {
    terminals: {
      'config:read-file': [
        { outcome: 'not-found', target: null },
        { outcome: 'error',     target: null },
      ],
      'config:parse-json': [
        { outcome: 'error', target: null },
      ],
      // validate-schema emits 'valid'/'invalid' (no 'success' port).
      // 'valid' re-routes to the next derived stage; 'invalid' terminates.
      'config:validate-schema': [
        { outcome: 'valid',   target: 'config:normalize-cache' },
        { outcome: 'invalid', target: null },
      ],
      'config:normalize-cache': [
        { outcome: 'invariant-violated', target: null },
      ],
      'config:assert-invariants': [
        { outcome: 'success',            target: null },
        { outcome: 'invariant-violated', target: null },
      ],
    },
  },
});
