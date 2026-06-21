// Replaces PathRipper's JSDOM fetchPage with cheerio — lighter, no JS execution.
// For JS-rendered pages, swap the fetch() call for a headless browser driver.

import { load } from 'cheerio';
import { RateLimiter } from '../modules/http/rateLimiter.js';
import { HttpRetryPolicy } from '../modules/http/httpRetryPolicy.js';
import { Logger } from '../modules/logger/logger.js';
import { ScraperCache } from '../modules/cache/ScraperCache.js';
import type { FetchTextResult } from '../types/Results.js';
import { HttpError } from '../errors/HttpError.js';
import { CacheMissError } from '../errors/CacheMissError.js';
import type { HtmlScraperConfigType, ScrapedPageType } from '../types/HtmlScraper.js';

export type { HtmlScraperConfigType, ScrapedPageType };

const DEFAULT_RATE_LIMIT_MS = 250;

/**
 * Fetches and parses HTML pages using cheerio with rate limiting and retry support.
 *
 * @remarks
 * Uses {@link RateLimiter} and {@link HttpRetryPolicy} for resilient HTTP fetching.
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
  readonly #policy: HttpRetryPolicy;
  readonly #log: Logger;
  /** Optional shared content store; null when not provided in config. */
  readonly #cache: ScraperCache | null;

  /**
   * @param config - Scraper configuration including base URL, rate limit, and headers.
   */
  private constructor(config: HtmlScraperConfigType) {
    this.#base    = config.baseUrl;
    this.#headers = config.headers ?? {};
    this.#limiter = RateLimiter.create({ minTimeMs: config.rateLimitMs ?? DEFAULT_RATE_LIMIT_MS, jitterMs: config.jitterMs ?? 0 });
    this.#policy  = HttpRetryPolicy.create({
      maxAttempts: config.maxRetries       ?? config.retry?.maxAttempts,
      baseDelayMs: config.retryBaseDelayMs ?? config.retry?.baseDelayMs,
      maxDelayMs:  config.retryMaxDelayMs  ?? config.retry?.maxDelayMs,
    });
    this.#log     = Logger.forComponent('HtmlScraper');
    this.#cache   = config.cache ?? null;
  }

  /**
   * Creates an HtmlScraper instance.
   *
   * @param config - Scraper configuration.
   * @returns A new HtmlScraper.
   */
  public static create(config: HtmlScraperConfigType): HtmlScraper {
    return new HtmlScraper(config);
  }

  /**
   * Fetches and parses a single HTML page.
   *
   * @param path - URL path or full URL to fetch.
   * @returns Scraped page with resolved URL, Cheerio document, and raw HTML.
   * @throws {HttpError} When the server returns a non-OK response.
   */
  async fetchPage(path: string): Promise<ScrapedPageType> {
    let url: string;
    if (path.startsWith('http')) {
      url = path;
    } else {
      // Normalise the join: ensure exactly one `/` between base and path,
      // regardless of whether base has a trailing slash or path has a
      // leading one. Tolerates the common case of users supplying
      // `Actions.aspx?ID=1` (no leading slash) on the CLI.
      const base = this.#base.endsWith('/') ? this.#base.slice(0, -1) : this.#base;
      const tail = path.startsWith('/')      ? path                   : `/${path}`;
      url = `${base}${tail}`;
    }
    this.#log.debug('fetchPage', url);

    const cache    = this.#cache;
    const cacheKey = cache !== null ? ScraperCache.keyFor({ method: 'GET', url, headers: this.#headers }) : '';

    if (cache !== null) {
      const hit = await cache.read(cacheKey);
      if (hit !== null) {
        this.#log.debug('fetchPage', 'cache hit', { url, key: cacheKey });
        return { url, $: load(hit.body), html: hit.body };
      }
      if (HtmlScraper.isReadOnly(cache)) {
        throw CacheMissError.create(`Cache miss for ${url}`, { key: cacheKey, url, metadata: { url } });
      }
    }

    const html = await this.#limiter.schedule((): Promise<string> =>
      this.#policy.run(async (): Promise<string> => {
        const res = await fetch(url, { headers: this.#headers });
        if (!res.ok) {
          throw HttpError.create(`HTTP ${res.status.toString()} ${url}`, { status: res.status, url });
        }
        return res.text();
      }),
    );

    if (cache !== null) {
      await cache.write(cacheKey, html, { url, method: 'GET', fetchedAt: new Date().toISOString(), status: 200 });
    }

    return { url, $: load(html), html };
  }

  /** Returns true when the cache config is read-only (no writes will reach disk). */
  private static isReadOnly(cache: ScraperCache): boolean {
    return cache.getMode() === 'read-only';
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
