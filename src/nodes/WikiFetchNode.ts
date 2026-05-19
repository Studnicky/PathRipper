import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContract } from '@noocodex/dagonizer/contracts';

import { ExternalSchemaError } from '../errors/ExternalSchemaError.js';
import type { WikiPageInterface } from '../types/MediaWikiScraper.js';
import { toNodeError }            from './fileUtils.js';
import type { ScrapeState }       from '../state/ScrapeState.js';
import type { RipperServices }       from '../services/RipperServices.js';

/** Returns true when the value looks like a MediaWikiScraper. */
const isWikiScraper = (s: unknown): s is { fetchPage(title: string): Promise<WikiPageInterface> } => {
  return typeof s === 'object' && s !== null && typeof (s as { fetchPage?: unknown }).fetchPage === 'function';
};

/**
 * Fetches `state.page.title` via `services.wikiScraper` and stores wikitext
 * on `state.page`. No-op when wikitext is already populated.
 *
 * Output ports:
 * - `success` — wikitext populated on `state.page.wikitext`.
 * - `error`   — fetch failed; item recorded in `state.failed`.
 *
 * @category Nodes
 * @since 3.0.0
 */
export const WikiFetchNode: NodeInterface<ScrapeState, 'success' | 'error', RipperServices> = {
  name: 'wiki:fetch',
  outputs: ['success', 'error'],

  async execute(state: ScrapeState, context: NodeContextInterface<RipperServices>): Promise<{ output: 'success' | 'error' }> {
    // No-op when wikitext already set.
    if (state.page.wikitext !== undefined && state.page.wikitext.length > 0) {
      return { output: 'success' };
    }

    const { services } = context;
    const scraper = services.wikiScraper;

    if (!isWikiScraper(scraper)) {
      state.collectError(toNodeError(
        ExternalSchemaError.create('wiki:fetch requires services.wikiScraper to be a MediaWikiScraper', { metadata: { task: 'wiki:fetch' } }),
        'wiki:fetch',
      ));
      return { output: 'error' };
    }

    const title = state.page.title;
    if (title.length === 0) {
      state.collectError(toNodeError(
        ExternalSchemaError.create('wiki:fetch requires state.page.title to be set', { metadata: { task: 'wiki:fetch', targetId: services.target.id } }),
        'wiki:fetch',
      ));
      return { output: 'error' };
    }

    let result: WikiPageInterface;
    try {
      result = await scraper.fetchPage(title);
    } catch (err) {
      state.collectError(toNodeError(err, 'wiki:fetch'));
      const currentTitle = state.getMetadata<string>('currentTitle') ?? title;
      state.failed.push(currentTitle);
      return { output: 'error' };
    }

    state.page = { ...state.page, wikitext: result.wikitext };
    return { output: 'success' };
  },
};

/** OperationContract for WikiFetchNode: reads page.title, produces page.wikitext. */
export const wikiFetchContract: OperationContract = {
  name:         'wiki:fetch',
  hardRequired: ['page.title'],
  produces:     ['page.wikitext'],
  outputs:      ['success', 'error'],
};
