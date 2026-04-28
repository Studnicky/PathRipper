import type { CheerioAPI } from 'cheerio';

import type { RetryConfigInterface } from './RetryExecutor.js';

/** Configuration for HtmlScraper instances. */
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

/** A fully fetched and parsed HTML page. */
export interface ScrapedPageInterface {
  /** Resolved URL of the fetched page. */
  readonly url: string;
  /** Cheerio document loaded from the page HTML. */
  readonly $: CheerioAPI;
  /** Raw HTML string of the page. */
  readonly html: string;
}
