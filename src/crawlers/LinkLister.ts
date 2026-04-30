import type { BuildListResult } from '../types/Results.js';
import { load } from 'cheerio';
import type { Element } from 'domhandler';
import { Logger } from '../modules/logger/logger.js';
import { RateLimiter } from '../modules/http/rateLimiter.js';
import { RetryExecutor } from '../modules/http/retryExecutor.js';
import { ScraperCache } from '../modules/cache/ScraperCache.js';
import type { LinkListerConfigInterface } from '../types/LinkListerConfig.js';

export type { LinkListerConfigInterface };

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const DEFAULT_RATE_LIMIT_MS = 100;

/**
 * Crawls a site from seed URLs and returns all matching target links, deduplicated and sorted.
 *
 * @remarks
 * Respects domain, target, and delimiter filters configured at construction time.
 * Rate limiting and retry behaviour are delegated to {@link RateLimiter} and {@link RetryExecutor}.
 * The shared {@link ScraperCache} is consulted before each network fetch so URLs already
 * fetched by sibling components (HtmlScraper, MediaWikiScraper) become free hits.
 *
 * @example
 * ```ts
 * const cache = ScraperCache.create({ dir: './.cache', mode: 'read-write' });
 * const lister = LinkLister.create({ domain: /example\.com/, target: /\/item\//, delimiter: /\//, cache });
 * const links = await lister.buildList(['https://example.com/items/']);
 * ```
 *
 * @category Crawlers
 * @since 2.0.0
 * @see {@link LinkListerConfigInterface}
 * @group Core
 */
export class LinkLister {
  readonly #domain: RegExp;
  readonly #target: RegExp;
  readonly #delimiter: RegExp;
  readonly #maxPages: number;
  readonly #visited   = new Set<string>();
  readonly #collected = new Set<string>();
  readonly #log: Logger;
  readonly #limiter: RateLimiter;
  readonly #retry: RetryExecutor;
  readonly #headers: Readonly<Record<string, string>>;
  readonly #cache: ScraperCache | null;

  /**
   * @param config - Crawl configuration including domain, target, rate-limit settings, and a shared cache.
   */
  private constructor(config: LinkListerConfigInterface) {
    this.#domain    = config.domain;
    this.#target    = config.target;
    this.#delimiter = config.delimiter;
    this.#maxPages  = config.maxPages ?? Number.POSITIVE_INFINITY;
    this.#log       = Logger.forComponent('LinkLister');
    this.#limiter   = RateLimiter.create({ minTimeMs: config.rateLimitMs ?? DEFAULT_RATE_LIMIT_MS, jitterMs: config.jitterMs ?? 0 });
    this.#retry     = RetryExecutor.create(config.retry);
    this.#headers   = config.headers ?? {};
    this.#cache     = config.cache ?? null;
  }

  /**
   * Creates a LinkLister instance.
   *
   * @param config - Crawl configuration.
   * @returns A new LinkLister.
   */
  public static create(config: LinkListerConfigInterface): LinkLister {
    return new LinkLister(config);
  }

  /**
   * Crawls from the given seed URLs and returns all collected target links.
   *
   * @param startUrls - Seed URLs to begin crawling from.
   * @returns Deduplicated, numerically sorted array of matching target URLs.
   */
  async buildList(startUrls: ReadonlyArray<string>): BuildListResult {
    if (startUrls.length === 0) {
      this.#log.warn('buildList', 'Called with empty startUrls list');
      return [];
    }
    this.#log.debug('buildList', `Starting crawl from ${startUrls.length.toString()} seed(s)`);

    const all: string[] = [];
    for (const url of startUrls) {
      if (this.#capReached()) break;
      const found = await this.#crawl(url);
      all.push(...found);
    }

    const sorted = Array.from(new Set(all)).sort(collator.compare);
    this.#log.info('buildList', `Found ${sorted.length.toString()} matching links`);
    return sorted;
  }

  #capReached(): boolean {
    return this.#collected.size >= this.#maxPages;
  }

  /** Fetches `url` via the shared cache (when configured); falls back to direct network on miss. */
  async #fetchBody(url: string): Promise<string> {
    const networkFetch = (): Promise<string> =>
      this.#limiter.schedule((): Promise<string> =>
        this.#retry.execute((): Promise<string> =>
          fetch(url, { headers: this.#headers }).then((r: Response): Promise<string> => r.text())),
      );

    if (this.#cache === null) return networkFetch();

    const key = ScraperCache.keyFor({ method: 'GET', url, headers: this.#headers });
    const hit = await this.#cache.read(key);
    if (hit !== null) {
      this.#log.debug('fetchBody', 'cache hit', { url, key });
      return hit.body;
    }

    const body = await networkFetch();
    await this.#cache.write(key, body, {
      url, method: 'GET', fetchedAt: new Date().toISOString(), status: 200,
    });
    return body;
  }

  async #crawl(url: string): Promise<string[]> {
    if (this.#visited.has(url)) return [];
    if (this.#capReached())     return [];
    this.#visited.add(url);

    const html = await this.#fetchBody(url);

    const allLinks = LinkLister.extractLinks(html, url)
      .filter((l: string): boolean => this.#domain.test(l))
      .filter((l: string): boolean => this.#delimiter.test(l));

    const targets:    string[] = [];
    const traversals: string[] = [];

    for (const link of allLinks) {
      if (this.#capReached()) break;
      if (this.#target.test(link)) {
        if (this.#collected.has(link)) continue;
        this.#collected.add(link);
        targets.push(link);
      } else if (!this.#visited.has(link)) {
        traversals.push(link);
      }
    }

    this.#log.debug('buildList', `${url} → ${targets.length.toString()} targets, ${traversals.length.toString()} to traverse`);

    const nested: string[][] = [];
    for (const l of traversals) {
      if (this.#capReached()) break;
      nested.push(await this.#crawl(l));
    }
    return [...targets, ...nested.flat()];
  }

  private static extractLinks(html: string, baseUrl: string): string[] {
    const $ = load(html);
    const links: string[] = [];
    $('a[href]').each((_i: number, el: Element): void => {
      const href = $(el).attr('href');
      if (href === undefined) return;
      try {
        links.push(new URL(href, baseUrl).href);
      } catch {
        // relative or invalid — skip
      }
    });
    return links;
  }
}
