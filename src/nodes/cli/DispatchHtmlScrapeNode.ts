import { dirname, resolve } from 'node:path';

import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContract } from '@noocodex/dagonizer/contracts';

import { runHtml }         from '../../run/runHtml.js';
import type { CliState }   from '../../state/CliState.js';
import type { CliServices } from './Services.js';

/**
 * Dispatches an HTML scrape run via `runHtml(opts)`.
 *
 * @remarks
 * Reads `state.config`, `state.targetId`, `state.outDir`, and `state.configPath`
 * to assemble the run options. Also reads the `paths` entry from
 * `state.options` (the `--paths` flag).
 *
 * Output ports:
 * - `success` — run completed with no failed-after-retry pages.
 * - `partial` — reserved for future partial-failure surfacing.
 * - `error`   — run threw an unrecoverable exception.
 *
 * @category Nodes
 * @since 3.1.0
 */
export const DispatchHtmlScrapeNode: NodeInterface<CliState, 'success' | 'partial' | 'error', CliServices> = {
  name:    'cli:dispatch-html-scrape',
  outputs: ['success', 'partial', 'error'],

  async execute(
    state:   CliState,
    context: NodeContextInterface<CliServices>,
  ): Promise<{ output: 'success' | 'partial' | 'error' }> {
    const log = context.services.log;

    if (state.config === null) {
      state.errorMessage = 'DispatchHtmlScrapeNode: config is null';
      log.error('DispatchHtmlScrapeNode', state.errorMessage);
      return { output: 'error' };
    }

    const rawPaths = state.options['paths'];
    const paths: string[] = Array.isArray(rawPaths) ? rawPaths as string[] : [];
    const configDir = dirname(resolve(state.configPath));

    // Validate: html targets need paths unless pipeline has crawl:list-targets.
    const htmlTarget = state.config.targets?.[state.targetId];
    if (htmlTarget === undefined) {
      state.errorMessage = `DispatchHtmlScrapeNode: target "${state.targetId}" not found in config.targets`;
      log.error('DispatchHtmlScrapeNode', state.errorMessage);
      return { output: 'error' };
    }

    const pipeline = (htmlTarget as Record<string, unknown>)['pipeline'];
    const hasCrawler = Array.isArray(pipeline) && (pipeline as string[]).includes('crawl:list-targets');

    if (paths.length === 0 && !hasCrawler) {
      state.errorMessage = '--paths required for html targets (or add crawl:list-targets to the pipeline)';
      log.error('DispatchHtmlScrapeNode', state.errorMessage);
      return { output: 'error' };
    }

    try {
      await runHtml({
        target:    state.targetId,
        paths,
        outDir:    state.outDir,
        configDir,
        config:    state.config,
      });

      state.failedCount = 0;
      return { output: 'success' };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      state.errorMessage = `HTML scrape failed: ${message}`;
      log.error('DispatchHtmlScrapeNode', state.errorMessage);
      return { output: 'error' };
    }
  },
};

/** OperationContract for DispatchHtmlScrapeNode: reads config + targetId, produces failedCount. */
export const dispatchHtmlScrapeContract: OperationContract = {
  name:         'cli:dispatch-html-scrape',
  hardRequired: ['config', 'targetId'],
  produces:     ['failedCount'],
  outputs:      ['success', 'partial', 'error'],
};
