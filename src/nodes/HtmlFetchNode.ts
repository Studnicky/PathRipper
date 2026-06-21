import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';

import { BaseError } from '../errors/BaseError.js';
import { HttpError } from '../errors/HttpError.js';
import { ExternalSchemaError } from '../errors/ExternalSchemaError.js';
import type { ScrapedPageType } from '../scrapers/HtmlScraper.js';
import type { RawContentType } from '../types/PipelineState.js';
import { toNodeError }              from './fileUtils.js';
import type { ScrapeState }         from '../state/ScrapeState.js';
import type { RipperServices }      from '../services/RipperServices.js';
import { LAST_FAILURE_KEY }         from '../resilience/FailurePolicy.js';

/** Returns true when the value looks like an HtmlScraper. */
const isHtmlScraper = (val: unknown): val is { fetchPage(url: string): Promise<ScrapedPageType> } => {
  return typeof val === 'object' && val !== null && typeof (val as { fetchPage?: unknown }).fetchPage === 'function';
};

type HtmlFetchOutput = 'success' | 'error' | 'cached';

/**
 * Reads `metadata['currentUrl']`, initialises `state.page` from it, then
 * fetches the page via `services.htmlScraper` and stores the response HTML +
 * resolved URL back on `state.page`.
 *
 * Output ports:
 * - `success` — page fetched; `state.page.html` is populated.
 * - `cached`  — page was served from cache (no live HTTP); same fields set.
 * - `error`   — fetch failed; failure context stashed under `LAST_FAILURE_KEY`
 *   in state metadata. Route to `route:failure` for policy-driven routing
 *   (retry / capture / resolve / expected).
 *
 * @category Nodes
 * @since 3.0.0
 */
class HtmlFetchNodeImpl extends ScalarNode<ScrapeState, HtmlFetchOutput, RipperServices> {
  public readonly name = 'html:fetch';
  public readonly outputs = ['success', 'error', 'cached'] as const;

  public override get outputSchema(): Record<HtmlFetchOutput, SchemaObjectType> {
    return {
      // `success` — page fetched from network; `state.page` populated with url, html, and optional _raw.
      success: {
        type: 'object',
        properties: {
          page: {
            type: 'object',
            properties: {
              targetId: { type: 'string' },
              title:    { type: 'string' },
              url:      { type: 'string' },
              html:     { type: 'string' },
              _raw:     { type: 'object' },
            },
            required: ['targetId', 'title', 'url', 'html'],
          },
        },
        required: ['page'],
      },
      // `cached` — page served from cache; same `state.page` shape as `success`.
      cached: {
        type: 'object',
        properties: {
          page: {
            type: 'object',
            properties: {
              targetId: { type: 'string' },
              title:    { type: 'string' },
              url:      { type: 'string' },
              html:     { type: 'string' },
              _raw:     { type: 'object' },
            },
            required: ['targetId', 'title', 'url', 'html'],
          },
        },
        required: ['page'],
      },
      // `error` — fetch failed; FailurePolicy.ContextType stashed under LAST_FAILURE_KEY; route to route:failure.
      error: { type: 'object' },
    };
  }

  protected override async executeOne(
    state:   ScrapeState,
    context: NodeContextType<RipperServices>,
  ): Promise<NodeOutputType<HtmlFetchOutput>> {
    const { services } = context;
    const scraper = services.htmlScraper;

    const url = state.getMetadata<string>('currentUrl') ?? '';
    if (url.length === 0) {
      state.collectError(toNodeError(
        ExternalSchemaError.create('html:fetch requires metadata[currentUrl] to be set', { metadata: { task: 'html:fetch', targetId: services.target.id } }),
        'html:fetch',
      ));
      return NodeOutputBuilder.of('error');
    }

    state.page = { targetId: services.target.id, title: '', url };

    if (!isHtmlScraper(scraper)) {
      state.collectError(toNodeError(
        ExternalSchemaError.create('html:fetch requires services.htmlScraper to be an HtmlScraper', { metadata: { task: 'html:fetch' } }),
        'html:fetch',
      ));
      return NodeOutputBuilder.of('error');
    }

    let result: ScrapedPageType;
    const fromCache = services.cache !== null && services.cache.has(url);
    try {
      result = await scraper.fetchPage(url);
      // Fetched cleanly — reset the retry budget so a later re-entry starts fresh.
      state.clearAttempts('html:fetch');
    } catch (err) {
      // Stash failure context for `route:failure` to classify.
      const status = err instanceof HttpError ? err.status : undefined;
      const retryable = err instanceof BaseError ? err.retryable : true;
      state.setMetadata(LAST_FAILURE_KEY, { url, status, retryable, phase: 'fetch', linkText: undefined });
      state.collectError(toNodeError(err, 'html:fetch'));
      return NodeOutputBuilder.of('error');
    }

    const includeRaw = services.includeRawContent !== false;
    const raw: RawContentType | undefined = includeRaw
      ? { contentType: 'text/html', content: result.html, fetchedAt: new Date().toISOString() }
      : undefined;

    state.page = {
      ...state.page,
      url:  result.url,
      html: result.html,
      ...(raw !== undefined ? { _raw: raw } : {}),
    };

    return NodeOutputBuilder.of(fromCache ? 'cached' : 'success');
  }
}

export const HtmlFetchNode = new HtmlFetchNodeImpl();
