import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContract } from '@noocodex/dagonizer/contracts';

import type { ConfigLoadState } from '../../state/ConfigLoadState.js';

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
export const ParseJsonNode: NodeInterface<ConfigLoadState, 'success' | 'error'> = {
  name: 'config:parse-json',
  outputs: ['success', 'error'],

  async execute(
    state: ConfigLoadState,
    _context: NodeContextInterface<undefined>,
  ): Promise<{ output: 'success' | 'error' }> {
    try {
      state.parsed = JSON.parse(state.raw) as unknown;
      return { output: 'success' };
    } catch (err: unknown) {
      const base    = err instanceof Error ? err : new Error(String(err));
      // V8's SyntaxError message includes position info — preserve it verbatim.
      const message = base.message;

      state.collectError({
        code:        'SyntaxError',
        message,
        operation:   'config:parse-json',
        recoverable: false,
        timestamp:   new Date().toISOString(),
      });

      return { output: 'error' };
    }
  },
};

/** OperationContract for ParseJsonNode: reads raw, produces parsed. */
export const parseJsonContract: OperationContract = {
  name:         'config:parse-json',
  hardRequired: ['raw'],
  produces:     ['parsed'],
  outputs:      ['success', 'error'],
};
