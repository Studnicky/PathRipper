import { ScalarNode, NodeOutputBuilder, NodeErrorBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';
import type { OperationContractType } from '@studnicky/dagonizer/contracts';

import type { ConfigLoadState } from '../../state/ConfigLoadState.js';

type ParseJsonOutput = 'success' | 'error';

/** OperationContractType for ParseJsonNode: reads raw, produces parsed. */
export const parseJsonContract: OperationContractType = {
  name:         'config:parse-json',
  hardRequired: ['raw'],
  produces:     ['parsed'],
  outputs:      ['success', 'error'],
};

/**
 * Parses `state.raw` as JSON and stores the result in `state.parsed`.
 *
 * Output ports:
 * - `success` — parsed successfully; `state.parsed` is populated.
 * - `error`   — JSON syntax error; error (with line/column where available)
 *               recorded on state via `state.collectError()`.
 *
 * @category Nodes
 * @since 3.0.0
 */
class ParseJsonNodeImpl extends ScalarNode<ConfigLoadState, ParseJsonOutput, undefined> {
  public readonly name = 'config:parse-json';
  public readonly outputs = ['success', 'error'] as const;
  public override readonly contract = parseJsonContract;

  protected override async executeOne(
    state: ConfigLoadState,
    _context: NodeContextType<undefined>,
  ): Promise<NodeOutputType<ParseJsonOutput>> {
    try {
      state.parsed = JSON.parse(state.raw) as unknown;
      return NodeOutputBuilder.of('success');
    } catch (err: unknown) {
      const base    = err instanceof Error ? err : new Error(String(err));
      // V8's SyntaxError message includes position info — preserve it verbatim.
      const message = base.message;

      state.collectError(NodeErrorBuilder.from(
        'SyntaxError',
        message,
        'config:parse-json',
        false,
        new Date().toISOString(),
      ));

      return NodeOutputBuilder.of('error');
    }
  }
}

export const ParseJsonNode = new ParseJsonNodeImpl();
