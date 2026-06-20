import { dirname, resolve } from 'node:path';

import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';

import { runHtml }         from '../../run/runHtml.js';
import type { CliState }   from '../../state/CliState.js';
import type { CliServices } from './Services.js';

type DispatchHtmlScrapeOutput = 'success' | 'partial' | 'error';

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
class DispatchHtmlScrapeNodeImpl extends ScalarNode<CliState, DispatchHtmlScrapeOutput, CliServices> {
  public readonly name = 'cli:dispatch-html-scrape';
  public readonly outputs = ['success', 'partial', 'error'] as const;

  protected override async executeOne(
    state:   CliState,
    context: NodeContextType<CliServices>,
  ): Promise<NodeOutputType<DispatchHtmlScrapeOutput>> {
    const log = context.services.log;

    if (state.config === null) {
      state.errorMessage = 'DispatchHtmlScrapeNode: config is null';
      log.error('DispatchHtmlScrapeNode', state.errorMessage);
      return NodeOutputBuilder.of('error');
    }

    const rawPaths = state.options['paths'];
    const paths: string[] = Array.isArray(rawPaths) ? rawPaths as string[] : [];
    const configDir = dirname(resolve(state.configPath));

    // Validate: html targets need paths unless pipeline has crawl:list-targets.
    const htmlTarget = state.config.targets?.[state.targetId];
    if (htmlTarget === undefined) {
      state.errorMessage = `DispatchHtmlScrapeNode: target "${state.targetId}" not found in config.targets`;
      log.error('DispatchHtmlScrapeNode', state.errorMessage);
      return NodeOutputBuilder.of('error');
    }

    const pipeline = (htmlTarget as Record<string, unknown>)['pipeline'];
    const hasCrawler = Array.isArray(pipeline) && (pipeline as string[]).includes('crawl:list-targets');

    if (paths.length === 0 && !hasCrawler) {
      state.errorMessage = '--paths required for html targets (or add crawl:list-targets to the pipeline)';
      log.error('DispatchHtmlScrapeNode', state.errorMessage);
      return NodeOutputBuilder.of('error');
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
      return NodeOutputBuilder.of('success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      state.errorMessage = `HTML scrape failed: ${message}`;
      log.error('DispatchHtmlScrapeNode', state.errorMessage);
      return NodeOutputBuilder.of('error');
    }
  }
}

export const DispatchHtmlScrapeNode = new DispatchHtmlScrapeNodeImpl();
