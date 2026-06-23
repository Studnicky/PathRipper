import type { CheerioAPI } from 'cheerio';

import type { HttpRetryConfigType } from '../modules/http/httpRetryPolicy.js';
import type { ScraperCache } from '../modules/cache/ScraperCache.js';

/**
 * Configuration passed to the `HtmlScraper` constructor.
 *
 * @remarks
 * `rateLimitMs` and `jitterMs` are forwarded to the internal `RateLimiter`.
 * `retry` is forwarded to `HttpRetryPolicy`; omit it to use defaults.
 *
 * @example
 * ```ts
 * const config: HtmlScraperConfigType = {
 *   baseUrl: 'https://example.com',
 *   rateLimitMs: 1000,
 *   jitterMs: 200,
 *   retry: { maxAttempts: 3, baseDelayMs: 500 },
 * };
 * ```
 *
 * @category Scrapers
 * @since 2.0.0
 * @see {@link ScrapedPageType}
 * @group Types
 */
export type HtmlScraperConfigType = {
  /** Base URL prepended to relative paths. */
  readonly baseUrl: string;
  /** Minimum milliseconds between requests. */
  readonly rateLimitMs?: number | undefined;
  /** Maximum random jitter added to each delay, in milliseconds. */
  readonly jitterMs?:    number | undefined;
  /** Retry configuration for failed requests. */
  readonly retry?: HttpRetryConfigType | undefined;
  /** Maximum number of retry attempts for failed requests (default 3). */
  readonly maxRetries?: number | undefined;
  /** Base delay in milliseconds for retry backoff (default 500). */
  readonly retryBaseDelayMs?: number | undefined;
  /** Maximum delay cap in milliseconds for retry backoff (default 30000). */
  readonly retryMaxDelayMs?: number | undefined;
  /** HTTP headers sent with every request. */
  readonly headers?: Readonly<Record<string, string>> | undefined;
  /** Optional shared content store; when set, fetchPage consults the cache before consuming the rate limiter. */
  readonly cache?: ScraperCache | undefined;
  /** When true, fetched HTML is processed through JSDOM before cheerio parsing. Enables synchronous script execution and DOM manipulation. Defaults to false. */
  readonly useJsdom?: boolean | undefined;
  /**
   * When `useJsdom` is true, ceiling in milliseconds for the JSDOM `load` event
   * wait. Defaults to `max(10_000, retryMaxDelayMs ?? 30_000)` so the fallback
   * scales with the site's retry tolerance. `Promise.race` resolves immediately
   * when `load` fires — a page that loads in 3s proceeds at 3s regardless of
   * this ceiling. Only raised for scripts that never fire `load` at all.
   */
  readonly jsdomLoadTimeoutMs?: number | undefined;
};

/**
 * Result of a single HTML page fetch performed by `HtmlScraper`.
 *
 * @remarks
 * The `$` property is a Cheerio document loaded from the raw `html`; both are
 * available so callers can either query via Cheerio or process the raw markup.
 *
 * @example
 * ```ts
 * const page: ScrapedPageType = await scraper.fetchPage('/wiki/Foo');
 * const title = page.$('h1').text();
 * ```
 *
 * @category Scrapers
 * @since 2.0.0
 * @see {@link HtmlScraperConfigType}
 * @group Types
 */
export type ScrapedPageType = {
  /** Resolved URL of the fetched page. */
  readonly url: string;
  /** Cheerio document loaded from the page HTML. */
  readonly $: CheerioAPI;
  /** Raw HTML string of the page. */
  readonly html: string;
};
