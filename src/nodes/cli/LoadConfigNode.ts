import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';

import { RipperConfig }    from '../../config/RipperConfig.js';
import type { CliState }   from '../../state/CliState.js';
import type { CliServices } from './Services.js';

type LoadConfigOutput = 'success' | 'error';

/**
 * Loads and normalizes the ripperoni config file at `state.configPath`.
 *
 * @remarks
 * Calls `RipperConfig.load(state.configPath)`, which internally dispatches the
 * `configLoadDAG`. From the CLI DAG's perspective this is a single async call;
 * the config-load sub-DAG is an implementation detail of `RipperConfig`.
 *
 * On success: `state.config` is populated with the normalized config.
 * On error: `state.errorMessage` is populated; routes to `error`.
 *
 * Output ports:
 * - `success` — config loaded and normalized; `state.config` is set.
 * - `error`   — load/validation failure; `state.errorMessage` is set.
 *
 * @category Nodes
 * @since 3.1.0
 */
class LoadConfigNodeImpl extends ScalarNode<CliState, LoadConfigOutput, CliServices> {
  public readonly name = 'cli:load-config';
  public readonly outputs = ['success', 'error'] as const;

  protected override async executeOne(
    state:   CliState,
    context: NodeContextType<CliServices>,
  ): Promise<NodeOutputType<LoadConfigOutput>> {
    const log = context.services.log;
    try {
      state.config = await RipperConfig.load(state.configPath);
      // Resolve outDir: if not set by the caller (--out flag), fall back to config.output.basePath.
      if (state.outDir.length === 0) {
        state.outDir = state.config.output.basePath;
      }
      log.debug('LoadConfigNode', `Config loaded from ${state.configPath}`);
      return NodeOutputBuilder.of('success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      state.errorMessage = `Failed to load config: ${message}`;
      log.error('LoadConfigNode', state.errorMessage);
      return NodeOutputBuilder.of('error');
    }
  }
}

export const LoadConfigNode = new LoadConfigNodeImpl();
