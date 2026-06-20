import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';

import { ExternalSchemaError } from '../errors/ExternalSchemaError.js';
import type { WikiPageInterface } from '../types/MediaWikiScraper.js';
import { toNodeError }            from './fileUtils.js';
import type { ScrapeState }       from '../state/ScrapeState.js';
import type { RipperServices }    from '../services/RipperServices.js';

/** Returns true when the value looks like a MediaWikiScraper. */
const isWikiScraper = (val: unknown): val is { fetchPage(title: string): Promise<WikiPageInterface> } => {
  return typeof val === 'object' && val !== null && typeof (val as { fetchPage?: unknown }).fetchPage === 'function';
};

type WikiFetchOutput = 'success' | 'error';

/**
 * Fetches `state.page.title` via `services.wikiScraper` and stores wikitext
 * on `state.page`. No-op when wikitext is already populated.
 *
 * Output ports:
 * - `success` — wikitext populated on `state.page.wikitext`.
 * - `cached`  — page was served from cache (no live HTTP); same fields set.
 * - `error`   — fetch failed; item recorded in `state.failed`.
 *
 * @category Nodes
 * @since 3.0.0
 */
class WikiFetchNodeImpl extends ScalarNode<ScrapeState, WikiFetchOutput, RipperServices> {
  public readonly name = 'wiki:fetch';
  public readonly outputs = ['success', 'error'] as const;

  protected override async executeOne(
    state:   ScrapeState,
    context: NodeContextType<RipperServices>,
  ): Promise<NodeOutputType<WikiFetchOutput>> {
    // No-op when wikitext already set.
    if (state.page.wikitext !== undefined && state.page.wikitext.length > 0) {
      return NodeOutputBuilder.of('success');
    }

    const { services } = context;
    const scraper = services.wikiScraper;

    if (!isWikiScraper(scraper)) {
      state.collectError(toNodeError(
        ExternalSchemaError.create('wiki:fetch requires services.wikiScraper to be a MediaWikiScraper', { metadata: { task: 'wiki:fetch' } }),
        'wiki:fetch',
      ));
      return NodeOutputBuilder.of('error');
    }

    const title = state.page.title;
    if (title.length === 0) {
      state.collectError(toNodeError(
        ExternalSchemaError.create('wiki:fetch requires state.page.title to be set', { metadata: { task: 'wiki:fetch', targetId: services.target.id } }),
        'wiki:fetch',
      ));
      return NodeOutputBuilder.of('error');
    }

    let result: WikiPageInterface;
    try {
      result = await scraper.fetchPage(title);
    } catch (err) {
      state.collectError(toNodeError(err, 'wiki:fetch'));
      const currentTitle = state.getMetadata<string>('currentTitle') ?? title;
      state.failed.push(currentTitle);
      return NodeOutputBuilder.of('error');
    }

    state.page = { ...state.page, wikitext: result.wikitext };
    return NodeOutputBuilder.of('success');
  }
}

export const WikiFetchNode = new WikiFetchNodeImpl();
