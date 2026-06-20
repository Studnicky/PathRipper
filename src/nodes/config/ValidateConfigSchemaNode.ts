import { ScalarNode, NodeOutputBuilder, NodeErrorBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';
import type { OperationContractType } from '@studnicky/dagonizer/contracts';

import type { RipperConfigInterface } from '../../types/Config.js';
import { RipperConfigSchema } from '../../schemas/internal/RipperConfigSchema.js';
import type { ConfigLoadState } from '../../state/ConfigLoadState.js';

type ValidateConfigSchemaOutput = 'valid' | 'invalid';

/** OperationContractType for ValidateConfigSchemaNode: reads parsed, produces validated. */
export const validateConfigSchemaContract: OperationContractType = {
  name:         'config:validate-schema',
  hardRequired: ['parsed'],
  produces:     ['validated'],
  outputs:      ['valid', 'invalid'],
};

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
class ValidateConfigSchemaNodeImpl extends ScalarNode<ConfigLoadState, ValidateConfigSchemaOutput, undefined> {
  public readonly name = 'config:validate-schema';
  public readonly outputs = ['valid', 'invalid'] as const;
  public override readonly contract = validateConfigSchemaContract;

  protected override async executeOne(
    state: ConfigLoadState,
    _context: NodeContextType<undefined>,
  ): Promise<NodeOutputType<ValidateConfigSchemaOutput>> {
    const errors = RipperConfigSchema.validate(state.parsed);
    if (errors !== null) {
      state.collectError(NodeErrorBuilder.from(
        'SCHEMA_INVALID',
        errors,
        'config:validate-schema',
        false,
        new Date().toISOString(),
      ));
      return NodeOutputBuilder.of('invalid');
    }

    state.validated = state.parsed as RipperConfigInterface;
    return NodeOutputBuilder.of('valid');
  }
}

export const ValidateConfigSchemaNode = new ValidateConfigSchemaNodeImpl();
