import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContract } from '@noocodex/dagonizer/contracts';

import type { CliState }    from '../../state/CliState.js';
import type { CliServices } from './Services.js';

/**
 * Logs the final scrape manifest state at the CLI layer.
 *
 * @remarks
 * `RipperRun.execute()` is responsible for writing `failures.json` when pages
 * fail after retry — that logic lives in the scrape layer and is not duplicated
 * here. This node's role is to demarcate the manifest-write boundary in the
 * CLI flow: after this node the dispatcher knows the run outcome and routes to
 * `ExitNode`.
 *
 * When `state.failedCount > 0` it logs a warning (`RipperRun` has already
 * written `failures.json`). When `state.failedCount === 0` it routes `skipped`
 * — no manifest was needed.
 *
 * Output ports:
 * - `success` — `state.failedCount > 0`; manifest was written by the orchestrator.
 * - `skipped` — `state.failedCount === 0`; no failures, nothing to write.
 *
 * @category Nodes
 * @since 3.1.0
 */
export const WriteManifestNode: NodeInterface<CliState, 'success' | 'skipped', CliServices> = {
  name:    'cli:write-manifest',
  outputs: ['success', 'skipped'],

  async execute(
    state:   CliState,
    context: NodeContextInterface<CliServices>,
  ): Promise<{ output: 'success' | 'skipped' }> {
    const log = context.services.log;

    if (state.failedCount > 0) {
      log.warn('WriteManifestNode',
        `${state.failedCount.toString()} pages failed after retry — failures.json written by orchestrator`);
      return { output: 'success' };
    }

    log.debug('WriteManifestNode', 'No failures — manifest skipped');
    return { output: 'skipped' };
  },
};

/** OperationContract for WriteManifestNode: reads failedCount, no state field produced. */
export const writeManifestContract: OperationContract = {
  name:         'cli:write-manifest',
  hardRequired: ['failedCount'],
  produces:     [],
  outputs:      ['success', 'skipped'],
};
