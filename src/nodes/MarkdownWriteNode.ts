import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join }    from 'node:path';

import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';

import { Logger }              from '../modules/logger/logger.js';
import { pageSlug }            from './fileUtils.js';
import { MarkdownConverter }   from '../markdown/MarkdownConverter.js';
import type { ScrapeState }    from '../state/ScrapeState.js';
import type { RipperServices } from '../services/RipperServices.js';

const log = Logger.forComponent('MarkdownWriteNode');

/**
 * Writes `state.page.html` as Markdown to `<outDir>/<targetId>/<pluginTaskName>/<slug>.md`.
 *
 * Mirrors the path logic of `JsonWriteNode` using `pageSlug` for the filename stem.
 * When `services.pluginTaskName` is set and `splitByTaskName` is not `false`, the
 * file lands under a per-plugin subfolder; otherwise directly under `<outDir>/<targetId>/`.
 *
 * Output ports:
 * - `success` — Markdown file written.
 * - `skipped` — `state.page.html` is empty or undefined; nothing written.
 *
 * @category Nodes
 * @since 3.3.0
 */
class MarkdownWriteNodeImpl extends ScalarNode<ScrapeState, 'success' | 'skipped', RipperServices> {
  public readonly name    = 'markdown:write';
  public readonly outputs = ['success', 'skipped'] as const;

  public override get outputSchema(): Record<'success' | 'skipped', SchemaObjectType> {
    return {
      // `success` — Markdown file written to disk; no state delta.
      success: { type: 'object' },
      // `skipped` — `state.page.html` was empty; no write performed; no state delta.
      skipped: { type: 'object' },
    };
  }

  protected override async executeOne(
    state:   ScrapeState,
    context: NodeContextType<RipperServices>,
  ): Promise<NodeOutputType<'success' | 'skipped'>> {
    const { services } = context;
    const html = state.page.html;

    if (html === undefined || html.length === 0) {
      log.debug('markdown:write', 'Skipping write — state.page.html is empty', { task: 'markdown:write' });
      return NodeOutputBuilder.of('skipped');
    }

    const slug            = pageSlug(state.page);
    const splitByTaskName = services.splitByTaskName !== false;
    const subdir          = (services.pluginTaskName !== undefined && splitByTaskName)
      ? services.pluginTaskName
      : '';
    const outFile = subdir.length > 0
      ? join(services.outDir, services.target.id, subdir, `${slug}.md`)
      : join(services.outDir, services.target.id, `${slug}.md`);

    await mkdir(dirname(outFile), { recursive: true });

    const markdown = MarkdownConverter.convert(html, state.page.url);
    await writeFile(outFile, markdown, 'utf8');

    log.debug('markdown:write', `Wrote Markdown: ${outFile}`, { task: 'markdown:write', outFile });
    return NodeOutputBuilder.of('success');
  }
}

/**
 * Built-in node — writes `state.page.html` as GFM Markdown to `<outDir>/<targetId>/<slug>.md`.
 *
 * @remarks
 * Registered as `markdown:write`. Routes to `success` when the file is written,
 * `skipped` when `state.page.html` is absent or empty.
 *
 * @example
 * ```json
 * { "@type": "SingleNode", "name": "write-md", "node": "markdown:write" }
 * ```
 *
 * @see {@link MarkdownConverter}
 * @category Nodes
 * @since 3.3.0
 * @group Core
 * @defaultValue Singleton instance created at module load time.
 */
export const MarkdownWriteNode = new MarkdownWriteNodeImpl();
