import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';

import { ExternalSchemaError } from '../errors/ExternalSchemaError.js';
import type { WikiPageType } from '../types/MediaWikiScraper.js';
import { toNodeError }            from './fileUtils.js';
import type { ScrapeState }       from '../state/ScrapeState.js';
import type { RipperServices }    from '../services/RipperServices.js';

/** Returns true when the value looks like a MediaWikiScraper. */
const isWikiScraper = (val: unknown): val is { fetchPage(title: string): Promise<WikiPageType> } => {
  return typeof val === 'object' && val !== null && typeof (val as { fetchPage?: unknown }).fetchPage === 'function';
};

type WikiFetchOutput = 'success' | 'error';

/**
 * Initialises `state.page` from per-clone metadata, then fetches wikitext via
 * `services.wikiScraper` when not already cached. Reads the page title from
 * `metadata['currentTitle']` so the node operates correctly inside a
 * `{ dag }` scatter body without requiring an external `pageSetup` callback.
 *
 * Output ports:
 * - `success` — wikitext populated on `state.page.wikitext`.
 * - `error`   — title missing, scraper invalid, or fetch failed; item
 *               recorded in `state.failed`.
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
    const { services } = context;

    // Initialise page from scatter-injected metadata before any other logic.
    const title = state.getMetadata<string>('currentTitle') ?? '';
    if (title.length === 0) {
      state.collectError(toNodeError(
        ExternalSchemaError.create('wiki:fetch requires metadata[currentTitle] to be set', { metadata: { task: 'wiki:fetch', targetId: services.target.id } }),
        'wiki:fetch',
      ));
      return NodeOutputBuilder.of('error');
    }

    const wikitext = state.getMetadata<string>(`wikitext:${title}`) ?? '';
    state.page = {
      targetId: services.target.id,
      title,
      url:      '',
      wikitext: wikitext.length > 0 ? wikitext : undefined,
    };

    // No-op when wikitext already populated from batch pre-fetch cache.
    if (state.page.wikitext !== undefined && state.page.wikitext.length > 0) {
      return NodeOutputBuilder.of('success');
    }

    const scraper = services.wikiScraper;

    if (!isWikiScraper(scraper)) {
      state.collectError(toNodeError(
        ExternalSchemaError.create('wiki:fetch requires services.wikiScraper to be a MediaWikiScraper', { metadata: { task: 'wiki:fetch' } }),
        'wiki:fetch',
      ));
      return NodeOutputBuilder.of('error');
    }

    let result: WikiPageType;
    try {
      result = await scraper.fetchPage(title);
    } catch (err) {
      state.collectError(toNodeError(err, 'wiki:fetch'));
      state.failed.push(title);
      return NodeOutputBuilder.of('error');
    }

    state.page = { ...state.page, wikitext: result.wikitext };
    return NodeOutputBuilder.of('success');
  }
}

export const WikiFetchNode = new WikiFetchNodeImpl();
