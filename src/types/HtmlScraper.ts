import type { CheerioAPI } from 'cheerio';

import type { RetryConfigInterface } from './RetryExecutor.js';

/**
 * Configuration passed to the `HtmlScraper` constructor.
 *
 * @remarks
 * `rateLimitMs` and `jitterMs` are forwarded to the internal `RateLimiter`.
 * `retry` is forwarded to `RetryExecutor`; omit it to disable retries.
 *
 * @example
 * ```ts
 * const config: HtmlScraperConfigInterface = {
 *   baseUrl: 'https://example.com',
 *   rateLimitMs: 1000,
 *   jitterMs: 200,
 *   retry: { maxAttempts: 3, baseDelayMs: 500 },
 * };
 * ```
 *
 * @category Scrapers
 * @since 2.0.0
 * @see {@link ScrapedPageInterface}
 * @group Types
 */
export interface HtmlScraperConfigInterface {
  /** Base URL prepended to relative paths. */
  readonly baseUrl: string;
  /** Minimum milliseconds between requests. */
  readonly rateLimitMs?: number | undefined;
  /** Maximum random jitter added to each delay, in milliseconds. */
  readonly jitterMs?:    number | undefined;
  /** Retry configuration for failed requests. */
  readonly retry?: RetryConfigInterface | undefined;
  /** HTTP headers sent with every request. */
  readonly headers?: Readonly<Record<string, string>> | undefined;
}

/**
 * Result of a single HTML page fetch performed by `HtmlScraper`.
 *
 * @remarks
 * The `$` property is a Cheerio document loaded from the raw `html`; both are
 * available so callers can either query via Cheerio or process the raw markup.
 *
 * @example
 * ```ts
 * const page: ScrapedPageInterface = await scraper.fetchPage('/wiki/Foo');
 * const title = page.$('h1').text();
 * ```
 *
 * @category Scrapers
 * @since 2.0.0
 * @see {@link HtmlScraperConfigInterface}
 * @group Types
 */
export interface ScrapedPageInterface {
  /** Resolved URL of the fetched page. */
  readonly url: string;
  /** Cheerio document loaded from the page HTML. */
  readonly $: CheerioAPI;
  /** Raw HTML string of the page. */
  readonly html: string;
}
