/**
 * configLoadFlow — contract-derived config-load flow.
 *
 * Uses DAGDeriver with `annotations.terminals` for all non-`success` output
 * ports. DAGDeriver is sufficient here because:
 *
 *   - The five nodes form a strict linear data chain via `produces ↔ hardRequired`
 *     matching: `path → raw → parsed → validated → normalized`.
 *   - All non-`success` outputs (`not-found`, `error`, `invalid`,
 *     `invariant-violated`) terminate the flow → `target: null`.
 *   - `config:validate-schema` emits `valid`/`invalid` instead of `success`/`error`.
 *     Both are declared in `terminals`: `valid` re-routes to the auto-derived next
 *     node (`config:normalize-cache`), `invalid` terminates. DAGDeriver still
 *     auto-wires `success → config:normalize-cache` from the data graph — this
 *     dead route is harmless since the node never emits `success`.
 *
 * Chain: config:read-file → config:parse-json → config:validate-schema
 *           → config:normalize-cache → config:assert-invariants
 */

import { DAGDeriver } from '@studnicky/dagonizer/derive';
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

// Synthesized terminal placements. Dagonizer 0.22 has no implicit `null` end:
// a terminating outcome routes to an inline `TerminalNode` via the `emit`
// variant. Two shared terminals — one marks the run `completed`, one `failed`;
// the deriver deduplicates by name.
const COMPLETED_TERMINAL = { name: 'config:completed', outcome: 'completed' } as const;
const FAILED_TERMINAL    = { name: 'config:failed',    outcome: 'failed' } as const;

/**
 * Config-load flow.
 *
 * @category Flows
 * @since 4.0.0
 */
export const configLoadFlow: DAGType = DAGDeriver.derive({
  name:       CONFIG_LOAD_FLOW,
  version:    '2.0',
  entrypoint: 'config:read-file',
  nodes: [
    ReadFileNode,
    ParseJsonNode,
    ValidateConfigSchemaNode,
    NormalizeCacheNode,
    AssertInvariantsNode,
  ],
  annotations: {
    terminals: {
      'config:read-file': [
        { outcome: 'not-found', emit: FAILED_TERMINAL },
        { outcome: 'error',     emit: FAILED_TERMINAL },
      ],
      'config:parse-json': [
        { outcome: 'error', emit: FAILED_TERMINAL },
      ],
      // validate-schema emits 'valid'/'invalid' (no 'success' port).
      // 'valid' re-routes to the next derived stage; 'invalid' terminates.
      'config:validate-schema': [
        { outcome: 'valid',   target: 'config:normalize-cache' },
        { outcome: 'invalid', emit: FAILED_TERMINAL },
      ],
      'config:normalize-cache': [
        { outcome: 'invariant-violated', emit: FAILED_TERMINAL },
      ],
      'config:assert-invariants': [
        { outcome: 'success',            emit: COMPLETED_TERMINAL },
        { outcome: 'invariant-violated', emit: FAILED_TERMINAL },
      ],
    },
  },
});
