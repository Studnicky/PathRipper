// Default fetch path uses cheerio — lightweight, no JS execution.
// Set useJsdom: true in config to run fetched HTML through JSDOM before cheerio
// parsing, enabling synchronous script execution and DOM manipulation.

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

const DEFAULT_RATE_LIMIT_MS          = 250;
const JSDOM_LOAD_TIMEOUT_MINIMUM_MS  = 10_000;
const JSDOM_LOAD_TIMEOUT_FALLBACK_MS = 30_000;
const HTTP_STATUS_OK                 = 200;

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
  readonly #useJsdom: boolean;
  readonly #jsdomLoadTimeoutMs: number;

  /**
   * @param config - Scraper configuration including base URL, rate limit, and headers.
   */
  private constructor(config: HtmlScraperConfigType) {
    this.#base    = config.baseUrl;
    this.#headers = config.headers ?? {};
    this.#limiter = RateLimiter.create({ minTimeMs: config.rateLimitMs ?? DEFAULT_RATE_LIMIT_MS, jitterMs: config.jitterMs ?? 0 });
    this.#policy  = HtmlScraper.#buildRetryPolicy(config);
    this.#log     = Logger.forComponent('HtmlScraper');
    this.#cache   = config.cache ?? null;
    this.#useJsdom = config.useJsdom ?? false;
    // Ceiling for the JSDOM load event wait: honour explicit config, then scale
    // to the site's retry tolerance (never less than the minimum). This ensures
    // a site with retryMaxDelayMs: 60_000 gets a proportionate ceiling rather
    // than a hardcoded constant that fires before natural load completes.
    this.#jsdomLoadTimeoutMs = config.jsdomLoadTimeoutMs
      ?? Math.max(JSDOM_LOAD_TIMEOUT_MINIMUM_MS, config.retryMaxDelayMs ?? JSDOM_LOAD_TIMEOUT_FALLBACK_MS);
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
      await cache.write(cacheKey, html, { url, method: 'GET', fetchedAt: new Date().toISOString(), status: HTTP_STATUS_OK });
    }

    return this.#parseHtml(html, url);
  }

  /** Returns true when the cache config is read-only (no writes will reach disk). */
  private static isReadOnly(cache: ScraperCache): boolean {
    return cache.getMode() === 'read-only';
  }

  async #parseHtml(html: string, url: string): Promise<ScrapedPageType> {
    if (!this.#useJsdom) {
      return { url, $: load(html), html };
    }
    const processedHtml = await this.#waitForJsdom(html, url);
    return { url, $: load(processedHtml), html: processedHtml };
  }

  async #waitForJsdom(html: string, url: string): Promise<string> {
    const { JSDOM, VirtualConsole } = await import('jsdom');
    // Omit `resources` so JSDOM loads no subresources (its default). External
    // scripts (analytics, tracking, SPA bundles) reliably fail under JSDOM due to
    // missing browser APIs and cause process-level unhandled rejections that
    // surface in test runners. The practical JSDOM use case — inline scripts that
    // manipulate the DOM before content is accessible — runs under
    // `runScripts: 'dangerously'` without any external resource loading.
    //
    // A bare VirtualConsole (no listeners) swallows the page's own console output
    // and, critically, the `jsdomError` events thrown by inline scripts that
    // reference unloaded globals (e.g. `$`/jQuery on Roll20). We serialize the DOM
    // and discard the page's console entirely; these errors are expected and must
    // not pollute the host process output.
    const virtualConsole = new VirtualConsole();
    const dom = new JSDOM(html, { url, runScripts: 'dangerously', virtualConsole });
    dom.window.onerror = (): boolean => true;
    // Single promise that resolves on either the 'load' event or the ceiling timeout,
    // whichever fires first. Uses an internal `fired` guard so neither branch can
    // call `resolve` twice if both events coincidentally fire in the same tick.
    await new Promise<void>((resolve: () => void): void => {
      let fired = false;
      const timer = setTimeout((): void => settle(), this.#jsdomLoadTimeoutMs);
      function settle(): void {
        if (fired) return;
        fired = true;
        clearTimeout(timer);
        resolve();
      }
      dom.window.addEventListener('load', settle);
    });
    // Capture the DOM before closing. window.close() aborts all pending resource
    // loads and stops script execution, preventing third-party analytics scripts
    // (posthog, clarity.ms, etc.) from propagating errors after we're done.
    const result = dom.serialize();
    dom.window.close();
    return result;
  }

  static #buildRetryPolicy(config: HtmlScraperConfigType): HttpRetryPolicy {
    const maxAttempts = config.maxRetries       ?? config.retry?.maxAttempts;
    const baseDelayMs = config.retryBaseDelayMs ?? config.retry?.baseDelayMs;
    const maxDelayMs  = config.retryMaxDelayMs  ?? config.retry?.maxDelayMs;
    return HttpRetryPolicy.create({ maxAttempts, baseDelayMs, maxDelayMs });
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
