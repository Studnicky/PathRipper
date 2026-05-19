import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContract } from '@noocodex/dagonizer/contracts';

import type { CliState }    from '../../state/CliState.js';
import type { CliServices } from './Services.js';

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
export const ResolveTargetNode: NodeInterface<CliState, 'html' | 'wiki' | 'not-found', CliServices> = {
  name:    'cli:resolve-target',
  outputs: ['html', 'wiki', 'not-found'],

  async execute(
    state:   CliState,
    context: NodeContextInterface<CliServices>,
  ): Promise<{ output: 'html' | 'wiki' | 'not-found' }> {
    const log = context.services.log;
    const config = state.config;

    if (config === null) {
      state.errorMessage = 'ResolveTargetNode: config is null — LoadConfigNode must run first';
      log.error('ResolveTargetNode', state.errorMessage);
      return { output: 'not-found' };
    }

    const inTargets  = config.targets?.[state.targetId] !== undefined;
    const inWiki     = config.mediawiki?.[state.targetId] !== undefined;

    // Command-specific validation: scrape-html only accepts html targets;
    // scrape-wiki only accepts wiki targets.
    if (state.command === 'scrape-html') {
      if (!inTargets) {
        state.errorMessage = `Unknown target: ${state.targetId}`;
        log.error('ResolveTargetNode', state.errorMessage);
        return { output: 'not-found' };
      }
      state.targetKind = 'html';
      log.debug('ResolveTargetNode', `Target "${state.targetId}" resolved as html (scrape-html)`);
      return { output: 'html' };
    }

    if (state.command === 'scrape-wiki') {
      if (!inWiki) {
        state.errorMessage = `Unknown mediawiki target: ${state.targetId}`;
        log.error('ResolveTargetNode', state.errorMessage);
        return { output: 'not-found' };
      }
      state.targetKind = 'wiki';
      log.debug('ResolveTargetNode', `Target "${state.targetId}" resolved as wiki (scrape-wiki)`);
      return { output: 'wiki' };
    }

    // Generic 'scrape' command: check targets first, then mediawiki.
    if (inTargets) {
      state.targetKind = 'html';
      log.debug('ResolveTargetNode', `Target "${state.targetId}" resolved as html`);
      return { output: 'html' };
    }

    if (inWiki) {
      state.targetKind = 'wiki';
      log.debug('ResolveTargetNode', `Target "${state.targetId}" resolved as wiki`);
      return { output: 'wiki' };
    }

    state.errorMessage = `Unknown target: ${state.targetId}`;
    log.error('ResolveTargetNode', state.errorMessage);
    return { output: 'not-found' };
  },
};

/** OperationContract for ResolveTargetNode: reads config + targetId, produces targetKind. */
export const resolveTargetContract: OperationContract = {
  name:         'cli:resolve-target',
  hardRequired: ['config', 'targetId'],
  produces:     ['targetKind'],
  outputs:      ['html', 'wiki', 'not-found'],
};
