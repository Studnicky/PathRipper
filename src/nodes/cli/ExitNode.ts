import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContract } from '@noocodex/dagonizer/contracts';

import type { CliState }    from '../../state/CliState.js';
import type { CliServices } from './Services.js';

/**
 * Terminal node for the CLI scrape DAG.
 *
 * @remarks
 * Sets `state.exitCode` based on the current `state.errorMessage` and
 * `state.failedCount`. The caller (`cli.ts`) reads `state.exitCode` after
 * `dispatcher.execute()` returns and passes it to `process.exit()`.
 *
 * Exit code logic:
 * - 0 — no `errorMessage` and `failedCount === 0` (clean success).
 * - 2 — no `errorMessage` but `failedCount > 0` (partial: some pages failed after retry).
 * - 1 — `errorMessage` is set (load/resolve/dispatch failure).
 *
 * Always returns `success` — the DAG executor needs a clean terminal output.
 *
 * Output ports:
 * - `success` — always; this is the DAG terminal.
 *
 * @category Nodes
 * @since 3.1.0
 */
export const ExitNode: NodeInterface<CliState, 'success', CliServices> = {
  name:    'cli:exit',
  outputs: ['success'],

  async execute(
    state:   CliState,
    context: NodeContextInterface<CliServices>,
  ): Promise<{ output: 'success' }> {
    const log = context.services.log;

    if (state.errorMessage.length > 0) {
      state.exitCode = 1;
      log.error('ExitNode', `Exiting with code 1: ${state.errorMessage}`);
    } else if (state.failedCount > 0) {
      state.exitCode = 2;
      log.warn('ExitNode', `Exiting with code 2: ${state.failedCount.toString()} pages failed after retry`);
    } else {
      state.exitCode = 0;
      log.debug('ExitNode', 'Exiting with code 0');
    }

    return { output: 'success' };
  },
};

/** OperationContract for ExitNode: reads errorMessage + failedCount, produces exitCode. */
export const exitNodeContract: OperationContract = {
  name:         'cli:exit',
  hardRequired: ['errorMessage', 'failedCount'],
  produces:     ['exitCode'],
  outputs:      ['success'],
};
