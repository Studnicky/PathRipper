import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContract } from '@noocodex/dagonizer/contracts';

import type { RipperConfigInterface } from '../../types/Config.js';
import { RipperConfigSchema } from '../../schemas/internal/RipperConfigSchema.js';
import type { ConfigLoadState } from '../../state/ConfigLoadState.js';

/**
 * Validates `state.parsed` against the `RipperConfigSchema` (AJV-backed).
 *
 * Distinct from `ValidateSchemaNode` in `src/nodes/ValidateSchemaNode.ts`,
 * which validates pipeline-state output payloads against external schema files.
 * This node validates the ripperoni config document itself against the internal
 * built-in schema.
 *
 * Output ports:
 * - `valid`   — schema validation passed; `state.validated` is populated.
 * - `invalid` — schema validation failed; AJV error string recorded on state.
 *
 * @category Nodes
 * @since 3.0.0
 */
export const ValidateConfigSchemaNode: NodeInterface<ConfigLoadState, 'valid' | 'invalid'> = {
  name: 'config:validate-schema',
  outputs: ['valid', 'invalid'],

  async execute(
    state: ConfigLoadState,
    _context: NodeContextInterface<undefined>,
  ): Promise<{ output: 'valid' | 'invalid' }> {
    const errors = RipperConfigSchema.validate(state.parsed);
    if (errors !== null) {
      state.collectError({
        code:        'SCHEMA_INVALID',
        message:     errors,
        operation:   'config:validate-schema',
        recoverable: false,
        timestamp:   new Date().toISOString(),
      });
      return { output: 'invalid' };
    }

    state.validated = state.parsed as RipperConfigInterface;
    return { output: 'valid' };
  },
};

/** OperationContract for ValidateConfigSchemaNode: reads parsed, produces validated. */
export const validateConfigSchemaContract: OperationContract = {
  name:         'config:validate-schema',
  hardRequired: ['parsed'],
  produces:     ['validated'],
  outputs:      ['valid', 'invalid'],
};
