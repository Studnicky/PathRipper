import { dirname, resolve } from 'node:path';

import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContract } from '@noocodex/dagonizer/contracts';

import { runWiki }         from '../../run/runWiki.js';
import type { CliState }   from '../../state/CliState.js';
import type { CliServices } from './Services.js';

/**
 * Dispatches a MediaWiki scrape run via `runWiki(opts)`.
 *
 * @remarks
 * Reads `state.config`, `state.targetId`, `state.outDir`, and `state.configPath`
 * to assemble the run options. Also reads `category` and `resumeFailures`
 * entries from `state.options`.
 *
 * Output ports:
 * - `success` — run completed (no thrown exception).
 * - `partial` — reserved for future use when the run surfaces partial failure counts.
 * - `error`   — run threw an unrecoverable exception.
 *
 * @category Nodes
 * @since 3.1.0
 */
export const DispatchWikiScrapeNode: NodeInterface<CliState, 'success' | 'partial' | 'error', CliServices> = {
  name:    'cli:dispatch-wiki-scrape',
  outputs: ['success', 'partial', 'error'],

  async execute(
    state:   CliState,
    context: NodeContextInterface<CliServices>,
  ): Promise<{ output: 'success' | 'partial' | 'error' }> {
    const log = context.services.log;

    if (state.config === null) {
      state.errorMessage = 'DispatchWikiScrapeNode: config is null';
      log.error('DispatchWikiScrapeNode', state.errorMessage);
      return { output: 'error' };
    }

    if (state.config.mediawiki?.[state.targetId] === undefined) {
      state.errorMessage = `DispatchWikiScrapeNode: target "${state.targetId}" not found in config.mediawiki`;
      log.error('DispatchWikiScrapeNode', state.errorMessage);
      return { output: 'error' };
    }

    const rawCategory      = state.options['category'];
    const rawResumeFailures = state.options['resumeFailures'];
    const category: string | undefined =
      typeof rawCategory === 'string' ? rawCategory : undefined;
    const resumeFailures: boolean | undefined =
      typeof rawResumeFailures === 'boolean' ? rawResumeFailures : undefined;

    const configDir = dirname(resolve(state.configPath));

    try {
      await runWiki({
        target:         state.targetId,
        outDir:         state.outDir,
        configDir,
        config:         state.config,
        ...(category        !== undefined ? { category }        : {}),
        ...(resumeFailures  !== undefined ? { resumeFailures }  : {}),
      });

      state.failedCount = 0;
      return { output: 'success' };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      state.errorMessage = `Wiki scrape failed: ${message}`;
      log.error('DispatchWikiScrapeNode', state.errorMessage);
      return { output: 'error' };
    }
  },
};

/** OperationContract for DispatchWikiScrapeNode: reads config + targetId, produces failedCount. */
export const dispatchWikiScrapeContract: OperationContract = {
  name:         'cli:dispatch-wiki-scrape',
  hardRequired: ['config', 'targetId'],
  produces:     ['failedCount'],
  outputs:      ['success', 'partial', 'error'],
};
