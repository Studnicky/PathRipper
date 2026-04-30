// Replaces PathRipper's JSDOM fetchPage with cheerio — lighter, no JS execution.
// For JS-rendered pages, swap the fetch() call for a headless browser driver.

import { load } from 'cheerio';
import { RateLimiter } from '../modules/http/rateLimiter.js';
import { RetryExecutor } from '../modules/http/retryExecutor.js';
import { Logger } from '../modules/logger/logger.js';
import type { FetchTextResult } from '../types/Results.js';
import { HttpError } from '../errors/HttpError.js';
import type { HtmlScraperConfigInterface, ScrapedPageInterface } from '../types/HtmlScraper.js';

export type { HtmlScraperConfigInterface, ScrapedPageInterface };

const DEFAULT_RATE_LIMIT_MS = 250;

/**
 * Fetches and parses HTML pages using cheerio with rate limiting and retry support.
 *
 * @remarks
 * Uses {@link RateLimiter} and {@link RetryExecutor} for resilient HTTP fetching.
 * Parses responses with cheerio; no JavaScript execution — swap `fetch` for a headless driver if needed.
 *
 * @example
 * ```ts
 * const scraper = HtmlScraper.create({ baseUrl: 'https://example.com', rateLimitMs: 250 });
 * const { $, html } = await scraper.fetchPage('/wiki/Goblin');
 * ```
 *
 * @category Scraping
 * @since 2.0.0
 * @see {@link RateLimiter}
 * @group Core
 */
export class HtmlScraper {
  readonly #base: string;
  readonly #headers: Readonly<Record<string, string>>;
  readonly #limiter: RateLimiter;
  readonly #retry: RetryExecutor;
  readonly #log: Logger;

  /**
   * @param config - Scraper configuration including base URL, rate limit, and headers.
   */
  private constructor(config: HtmlScraperConfigInterface) {
    this.#base    = config.baseUrl;
    this.#headers = config.headers ?? {};
    this.#limiter = RateLimiter.create({ minTimeMs: config.rateLimitMs ?? DEFAULT_RATE_LIMIT_MS, jitterMs: config.jitterMs ?? 0 });
    this.#retry   = RetryExecutor.create({
      maxAttempts: config.maxRetries       ?? config.retry?.maxAttempts,
      baseDelayMs: config.retryBaseDelayMs ?? config.retry?.baseDelayMs,
      maxDelayMs:  config.retryMaxDelayMs  ?? config.retry?.maxDelayMs,
      multiplier:  config.retry?.multiplier,
    });
    this.#log     = Logger.forComponent('HtmlScraper');
  }

  /**
   * Creates an HtmlScraper instance.
   *
   * @param config - Scraper configuration.
   * @returns A new HtmlScraper.
   */
  public static create(config: HtmlScraperConfigInterface): HtmlScraper {
    return new HtmlScraper(config);
  }

  /**
   * Fetches and parses a single HTML page.
   *
   * @param path - URL path or full URL to fetch.
   * @returns Scraped page with resolved URL, Cheerio document, and raw HTML.
   * @throws {HttpError} When the server returns a non-OK response.
   */
  async fetchPage(path: string): Promise<ScrapedPageInterface> {
    const url = path.startsWith('http') ? path : `${this.#base}${path}`;
    this.#log.debug('fetchPage', url);

    const html = await this.#limiter.schedule((): Promise<string> =>
      this.#retry.execute(async (): Promise<string> => {
        const res = await fetch(url, { headers: this.#headers });
        if (!res.ok) {
          throw HttpError.create(`HTTP ${res.status.toString()} ${url}`, { status: res.status, url });
        }
        return res.text();
      }),
    );

    return { url, $: load(html), html };
  }

  /**
   * Fetches a page and returns only its raw HTML string.
   *
   * @param path - URL path or full URL to fetch.
   * @returns Raw HTML string of the fetched page.
   * @throws {HttpError} When the server returns a non-OK response.
   */
  async fetchText(path: string): FetchTextResult {
    const { html } = await this.fetchPage(path);
    return html;
  }
}
