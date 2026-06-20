import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';

import type { CliState }    from '../../state/CliState.js';
import type { CliServices } from './Services.js';

type ExitOutput = 'success';

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
class ExitNodeImpl extends ScalarNode<CliState, ExitOutput, CliServices> {
  public readonly name = 'cli:exit';
  public readonly outputs = ['success'] as const;

  protected override async executeOne(
    state:   CliState,
    context: NodeContextType<CliServices>,
  ): Promise<NodeOutputType<ExitOutput>> {
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

    return NodeOutputBuilder.of('success');
  }
}

export const ExitNode = new ExitNodeImpl();
