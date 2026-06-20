import { dirname, resolve } from 'node:path';

import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';

import { runWiki }         from '../../run/runWiki.js';
import type { CliState }   from '../../state/CliState.js';
import type { CliServices } from './Services.js';

type DispatchWikiScrapeOutput = 'success' | 'partial' | 'error';

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
class DispatchWikiScrapeNodeImpl extends ScalarNode<CliState, DispatchWikiScrapeOutput, CliServices> {
  public readonly name = 'cli:dispatch-wiki-scrape';
  public readonly outputs = ['success', 'partial', 'error'] as const;

  protected override async executeOne(
    state:   CliState,
    context: NodeContextType<CliServices>,
  ): Promise<NodeOutputType<DispatchWikiScrapeOutput>> {
    const log = context.services.log;

    if (state.config === null) {
      state.errorMessage = 'DispatchWikiScrapeNode: config is null';
      log.error('DispatchWikiScrapeNode', state.errorMessage);
      return NodeOutputBuilder.of('error');
    }

    if (state.config.mediawiki?.[state.targetId] === undefined) {
      state.errorMessage = `DispatchWikiScrapeNode: target "${state.targetId}" not found in config.mediawiki`;
      log.error('DispatchWikiScrapeNode', state.errorMessage);
      return NodeOutputBuilder.of('error');
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
      return NodeOutputBuilder.of('success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      state.errorMessage = `Wiki scrape failed: ${message}`;
      log.error('DispatchWikiScrapeNode', state.errorMessage);
      return NodeOutputBuilder.of('error');
    }
  }
}

export const DispatchWikiScrapeNode = new DispatchWikiScrapeNodeImpl();
