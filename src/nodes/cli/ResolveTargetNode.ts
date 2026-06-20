import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';

import type { CliState }    from '../../state/CliState.js';
import type { CliServices } from './Services.js';

type ResolveTargetOutput = 'html' | 'wiki' | 'not-found';

/**
 * Resolves `state.targetId` against the loaded config.
 *
 * @remarks
 * Checks `state.config.targets` first (HTML targets), then
 * `state.config.mediawiki` (wiki targets). Sets `state.targetKind`
 * accordingly and routes to the matching output port.
 *
 * Must run after `LoadConfigNode` (requires `state.config !== null`).
 *
 * Output ports:
 * - `html`      — target found in `config.targets`; `state.targetKind = 'html'`.
 * - `wiki`      — target found in `config.mediawiki`; `state.targetKind = 'wiki'`.
 * - `not-found` — target not found in either collection.
 *
 * @category Nodes
 * @since 3.1.0
 */
class ResolveTargetNodeImpl extends ScalarNode<CliState, ResolveTargetOutput, CliServices> {
  public readonly name = 'cli:resolve-target';
  public readonly outputs = ['html', 'wiki', 'not-found'] as const;

  protected override async executeOne(
    state:   CliState,
    context: NodeContextType<CliServices>,
  ): Promise<NodeOutputType<ResolveTargetOutput>> {
    const log = context.services.log;
    const config = state.config;

    if (config === null) {
      state.errorMessage = 'ResolveTargetNode: config is null — LoadConfigNode must run first';
      log.error('ResolveTargetNode', state.errorMessage);
      return NodeOutputBuilder.of('not-found');
    }

    const inTargets  = config.targets?.[state.targetId] !== undefined;
    const inWiki     = config.mediawiki?.[state.targetId] !== undefined;

    // Command-specific validation: scrape-html only accepts html targets;
    // scrape-wiki only accepts wiki targets.
    if (state.command === 'scrape-html') {
      if (!inTargets) {
        state.errorMessage = `Unknown target: ${state.targetId}`;
        log.error('ResolveTargetNode', state.errorMessage);
        return NodeOutputBuilder.of('not-found');
      }
      state.targetKind = 'html';
      log.debug('ResolveTargetNode', `Target "${state.targetId}" resolved as html (scrape-html)`);
      return NodeOutputBuilder.of('html');
    }

    if (state.command === 'scrape-wiki') {
      if (!inWiki) {
        state.errorMessage = `Unknown mediawiki target: ${state.targetId}`;
        log.error('ResolveTargetNode', state.errorMessage);
        return NodeOutputBuilder.of('not-found');
      }
      state.targetKind = 'wiki';
      log.debug('ResolveTargetNode', `Target "${state.targetId}" resolved as wiki (scrape-wiki)`);
      return NodeOutputBuilder.of('wiki');
    }

    // Generic 'scrape' command: check targets first, then mediawiki.
    if (inTargets) {
      state.targetKind = 'html';
      log.debug('ResolveTargetNode', `Target "${state.targetId}" resolved as html`);
      return NodeOutputBuilder.of('html');
    }

    if (inWiki) {
      state.targetKind = 'wiki';
      log.debug('ResolveTargetNode', `Target "${state.targetId}" resolved as wiki`);
      return NodeOutputBuilder.of('wiki');
    }

    state.errorMessage = `Unknown target: ${state.targetId}`;
    log.error('ResolveTargetNode', state.errorMessage);
    return NodeOutputBuilder.of('not-found');
  }
}

export const ResolveTargetNode = new ResolveTargetNodeImpl();
