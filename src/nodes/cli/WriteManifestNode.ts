import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';

import type { CliState }    from '../../state/CliState.js';
import type { CliServices } from './Services.js';

type WriteManifestOutput = 'success' | 'skipped';

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
class WriteManifestNodeImpl extends ScalarNode<CliState, WriteManifestOutput, CliServices> {
  public readonly name = 'cli:write-manifest';
  public readonly outputs = ['success', 'skipped'] as const;

  protected override async executeOne(
    state:   CliState,
    context: NodeContextType<CliServices>,
  ): Promise<NodeOutputType<WriteManifestOutput>> {
    const log = context.services.log;

    if (state.failedCount > 0) {
      log.warn('WriteManifestNode',
        `${state.failedCount.toString()} pages failed after retry — failures.json written by orchestrator`);
      return NodeOutputBuilder.of('success');
    }

    log.debug('WriteManifestNode', 'No failures — manifest skipped');
    return NodeOutputBuilder.of('skipped');
  }
}

export const WriteManifestNode = new WriteManifestNodeImpl();
