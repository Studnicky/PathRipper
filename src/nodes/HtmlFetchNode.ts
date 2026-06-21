import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';

import { BaseError } from '../errors/BaseError.js';
import { ExternalSchemaError } from '../errors/ExternalSchemaError.js';
import type { ScrapedPageType } from '../scrapers/HtmlScraper.js';
import type { RawContentType } from '../types/PipelineState.js';
import { toNodeError }              from './fileUtils.js';
import type { ScrapeState }         from '../state/ScrapeState.js';
import type { RipperServices }      from '../services/RipperServices.js';

/** Returns true when the value looks like an HtmlScraper. */
const isHtmlScraper = (val: unknown): val is { fetchPage(url: string): Promise<ScrapedPageType> } => {
  return typeof val === 'object' && val !== null && typeof (val as { fetchPage?: unknown }).fetchPage === 'function';
};

type HtmlFetchOutput = 'success' | 'error' | 'cached' | 'retry';

/**
 * Number of DAG-level re-fetch attempts for a *transient* failure before the
 * page routes to `error`. The scraper's own `HttpRetryPolicy` already retries
 * transient HTTP errors per request; this is a second, coarser layer — each DAG
 * retry re-runs the whole fetch — bounded by the native `recordAttempt` budget.
 */
const MAX_DAG_FETCH_RETRIES = 2;

/** Budget key for the per-page fetch retry loop. */
const FETCH_RETRY_KEY = 'html:fetch';

/**
 * Reads `metadata['currentUrl']`, initialises `state.page` from it, then
 * fetches the page via `services.htmlScraper` and stores the response HTML +
 * resolved URL back on `state.page`.
 *
 * Output ports:
 * - `success` — page fetched; `state.page.html` is populated.
 * - `cached`  — page was served from cache (no live HTTP); same fields set.
 * - `retry`   — a *transient* failure (5xx/429/network) with the DAG retry
 *   budget unspent; wire this port back to `html:fetch` for a bounded re-fetch.
 * - `error`   — a *permanent* failure (4xx such as 404) or the retry budget is
 *   exhausted; the error is recorded on `state.errors` and the url on
 *   `state.failed`. Route to `error:capture` to persist it as inspectable data.
 *
 * @category Nodes
 * @since 3.0.0
 */
class HtmlFetchNodeImpl extends ScalarNode<ScrapeState, HtmlFetchOutput, RipperServices> {
  public readonly name = 'html:fetch';
  public readonly outputs = ['success', 'error', 'cached', 'retry'] as const;

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
      // `retry` — transient failure, DAG retry budget unspent; one attempt
      // recorded on `state.recordAttempt('html:fetch')`. No page delta.
      retry: { type: 'object' },
      // `error` — fetch failed; error recorded on state via collectError; `state.failed` may have the url appended.
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
    } catch (err) {
      // Classify: a `BaseError` carries `retryable` (HttpError sets it false for
      // 4xx like 404, true for 5xx/429/undefined-status); a non-BaseError is a
      // raw network failure — treat as transient. Transient failures route to
      // `retry` (a bounded DAG self-loop) until the budget is spent; permanent
      // failures route straight to `error`.
      const transient = err instanceof BaseError ? err.retryable : true;
      if (transient && state.recordAttempt(FETCH_RETRY_KEY) <= MAX_DAG_FETCH_RETRIES) {
        return NodeOutputBuilder.of('retry');
      }
      state.clearAttempts(FETCH_RETRY_KEY);
      state.collectError(toNodeError(err, 'html:fetch'));
      state.failed.push(url);
      return NodeOutputBuilder.of('error');
    }
    // Fetched cleanly — reset the retry budget so a later re-entry starts fresh.
    state.clearAttempts(FETCH_RETRY_KEY);

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
