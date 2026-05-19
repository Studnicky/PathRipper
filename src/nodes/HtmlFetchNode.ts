import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContract } from '@noocodex/dagonizer/contracts';

import { ExternalSchemaError } from '../errors/ExternalSchemaError.js';
import type { ScrapedPageInterface } from '../scrapers/HtmlScraper.js';
import type { RawContentInterface } from '../types/PipelineState.js';
import { toNodeError }              from './fileUtils.js';
import type { ScrapeState }         from '../state/ScrapeState.js';
import type { RipperServices }         from '../services/RipperServices.js';

/** Returns true when the value looks like an HtmlScraper. */
const isHtmlScraper = (s: unknown): s is { fetchPage(url: string): Promise<ScrapedPageInterface> } => {
  return typeof s === 'object' && s !== null && typeof (s as { fetchPage?: unknown }).fetchPage === 'function';
};

/**
 * Fetches `state.page.url` via `services.htmlScraper` and stores the response
 * HTML + resolved URL back on `state.page`.
 *
 * Output ports:
 * - `success` — page fetched; `state.page.html` is populated.
 * - `cached`  — page was served from cache (no live HTTP); same fields set.
 * - `error`   — fetch failed (404, network error, etc); `state.failed` item recorded.
 *
 * @category Nodes
 * @since 3.0.0
 */
export const HtmlFetchNode: NodeInterface<ScrapeState, 'success' | 'error' | 'cached', RipperServices> = {
  name: 'html:fetch',
  outputs: ['success', 'error', 'cached'],

  async execute(state: ScrapeState, context: NodeContextInterface<RipperServices>): Promise<{ output: 'success' | 'error' | 'cached' }> {
    const { services } = context;
    const scraper = services.htmlScraper;

    if (!isHtmlScraper(scraper)) {
      state.collectError(toNodeError(
        ExternalSchemaError.create('html:fetch requires services.htmlScraper to be an HtmlScraper', { metadata: { task: 'html:fetch' } }),
        'html:fetch',
      ));
      return { output: 'error' };
    }

    const url = state.page.url;
    if (url.length === 0) {
      state.collectError(toNodeError(
        ExternalSchemaError.create('html:fetch requires state.page.url to be set', { metadata: { task: 'html:fetch', targetId: services.target.id } }),
        'html:fetch',
      ));
      return { output: 'error' };
    }

    let result: ScrapedPageInterface;
    const fromCache = services.cache !== null && services.cache.has(url);
    try {
      result = await scraper.fetchPage(url);
    } catch (err) {
      state.collectError(toNodeError(err, 'html:fetch'));
      const currentUrl = state.getMetadata<string>('currentUrl') ?? url;
      state.failed.push(currentUrl);
      return { output: 'error' };
    }

    const includeRaw = services.target.cfg['includeRawContent'] !== false;
    const raw: RawContentInterface | undefined = includeRaw
      ? { contentType: 'text/html', content: result.html, fetchedAt: new Date().toISOString() }
      : undefined;

    state.page = {
      ...state.page,
      url:  result.url,
      html: result.html,
      ...(raw !== undefined ? { _raw: raw } : {}),
    };

    return { output: fromCache ? 'cached' : 'success' };
  },
};

/** OperationContract for HtmlFetchNode: reads page.url, produces page.html. */
export const htmlFetchContract: OperationContract = {
  name:         'html:fetch',
  hardRequired: ['page.url'],
  produces:     ['page.html'],
  outputs:      ['success', 'error', 'cached'],
};
