import type { FetchPageResult, FetchPagesBatchResult, FetchCategoryResult, FetchAllPagesResult } from '../types/Results.js';
import { HttpError } from '../errors/HttpError.js';
import { CacheMissError } from '../errors/CacheMissError.js';
import { RateLimiter } from '../modules/http/rateLimiter.js';
import { HttpRetryPolicy } from '../modules/http/httpRetryPolicy.js';
import { Logger } from '../modules/logger/logger.js';
import { ScraperCache } from '../modules/cache/ScraperCache.js';
import type {
  MediaWikiConfigType,
  WikiPageType,
  CategoryMemberType,
  AllPagesResponseType,
  CategoryMembersResponseType,
  RevisionsPageType,
  RevisionsResponseType,
} from '../types/MediaWikiScraper.js';

export type { MediaWikiConfigType, WikiPageType, CategoryMemberType };

const API_CATEGORY_LIMIT      = 500;
const DEFAULT_ALL_PAGES_LIMIT = 500;
const DEFAULT_RATE_LIMIT_MS   = 1_000;

/**
 * Fetches wikitext content and category membership from a MediaWiki action API.
 *
 * @remarks
 * Create instances via `MediaWikiScraper.create`. Supports rate limiting and automatic
 * pagination for category and all-pages enumeration.
 *
 * @example
 * ```ts
 * const scraper = await MediaWikiScraper.create({ apiUrl: 'https://wiki.example.com/api.php' });
 * const members = await scraper.fetchCategory('Ships');
 * ```
 * @category Scrapers
 * @since 2.0.0
 * @group Scrapers
 * @see MediaWikiConfigType
 */
export class MediaWikiScraper {
  readonly #apiUrl:  string;
  readonly #headers: Readonly<Record<string, string>>;
  readonly #limiter: RateLimiter;
  readonly #policy:  HttpRetryPolicy;
  readonly #log:     Logger;
  /** Optional shared content store; null when not provided in config. */
  readonly #cache:   ScraperCache | null;

  /**
   * @param config - MediaWiki API URL and optional rate-limit settings.
   */
  private constructor(config: MediaWikiConfigType) {
    this.#apiUrl   = config.apiUrl;
    this.#headers  = { 'Accept': 'application/json, */*' };
    this.#limiter  = RateLimiter.create({ minTimeMs: config.rateLimitMs ?? DEFAULT_RATE_LIMIT_MS, jitterMs: config.jitterMs ?? 0 });
    this.#policy   = HttpRetryPolicy.create({
      maxAttempts: config.maxRetries       ?? 3,
      baseDelayMs: config.retryBaseDelayMs ?? 500,
      maxDelayMs:  config.retryMaxDelayMs  ?? 30_000,
    });
    this.#log      = Logger.forComponent('MediaWikiScraper');
    this.#cache    = config.cache ?? null;
  }

  /**
   * Creates a MediaWikiScraper instance.
   *
   * @param config - MediaWiki configuration.
   * @returns A new MediaWikiScraper.
   */
  public static async create(config: MediaWikiConfigType): Promise<MediaWikiScraper> {
    return new MediaWikiScraper(config);
  }

  /**
   * Fetches the wikitext content of a single article (cache-aware via fetchPagesBatch).
   *
   * @param title - Article title to fetch.
   * @returns Wiki page with title and wikitext content.
   * @throws {HttpError} When the API returns a non-OK response.
   */
  public async fetchPage(title: string): FetchPageResult {
    this.#log.debug('fetchPage', title);
    const [page] = await this.fetchPagesBatch([title]);
    return page ?? { title, wikitext: '' };
  }

  /**
   * Fetches wikitext for multiple articles, partitioning by per-title cache hits.
   *
   * @param titles - Array of article titles to fetch.
   * @returns Array of wiki pages with title and wikitext content.
   * @throws {HttpError} When the API returns a non-OK response.
   * @throws {CacheMissError} When mode is `read-only` and any title is missing.
   */
  public async fetchPagesBatch(titles: string[]): FetchPagesBatchResult {
    this.#log.debug('fetchPagesBatch', `${titles.length.toString()} pages`);
    if (titles.length === 0) return [];

    const cache = this.#cache;

    const cached: WikiPageType[] = [];
    const missing: string[]           = [];

    if (cache !== null) {
      for (const title of titles) {
        const key = this.#cacheKeyForTitle(title);
        const hit = await cache.read(key);
        if (hit !== null) {
          cached.push({ title, wikitext: hit.body });
        } else {
          missing.push(title);
        }
      }
      if (cache.getMode() === 'read-only' && missing.length > 0) {
        throw CacheMissError.create(`MediaWiki cache miss for ${missing.length.toString()} title(s)`, {
          metadata: { titles: missing, apiUrl: this.#apiUrl },
        });
      }
    } else {
      missing.push(...titles);
    }

    if (missing.length === 0) return cached;

    const fetched = await this.#limiter.schedule((): Promise<WikiPageType[]> =>
      this.#policy.run(async (): Promise<WikiPageType[]> => {
        const params = new URLSearchParams({
          action: 'query', titles: missing.join('|'), prop: 'revisions', redirects: '1',
          rvprop: 'content', format: 'json',
        });
        const data = await this.#get<RevisionsResponseType>(params);
        return Object.values(data.query?.pages ?? {}).map((pageData: RevisionsPageType): WikiPageType => ({
          title:    pageData.title,
          wikitext: MediaWikiScraper.wikitextOf(pageData),
        }));
      }),
    );

    if (cache !== null) {
      const fetchedAt = new Date().toISOString();
      for (const page of fetched) {
        const key = this.#cacheKeyForTitle(page.title);
        await cache.write(key, page.wikitext, { url: this.#apiUrl, method: 'GET', fetchedAt, status: 200 });
      }
    }

    return [...cached, ...fetched];
  }

  /** Stable per-title cache key derived from the API URL and the title header. */
  #cacheKeyForTitle(title: string): string {
    return ScraperCache.keyFor({ method: 'GET', url: this.#apiUrl, headers: { titles: title } });
  }

  /**
   * Fetches all members of a MediaWiki category, paginating through continuation tokens.
   *
   * @param categoryName - Category name without the `Category:` prefix.
   * @returns All page titles and IDs belonging to the category.
   * @throws {HttpError} When the API returns a non-OK response.
   */
  public async fetchCategory(categoryName: string): FetchCategoryResult {
    this.#log.info('fetchCategory', categoryName);
    const members: CategoryMemberType[] = [];
    let continueParams: Record<string, string> = {};

    do {
      const params = new URLSearchParams({
        action:  'query', list: 'categorymembers',
        cmtitle: `Category:${categoryName}`,
        cmlimit: API_CATEGORY_LIMIT.toString(), cmtype: 'page', format: 'json',
        ...continueParams,
      });

      const data = await this.#limiter.schedule((): Promise<CategoryMembersResponseType> =>
        this.#policy.run((): Promise<CategoryMembersResponseType> =>
          this.#get<CategoryMembersResponseType>(params),
        ),
      );

      for (const catMember of data.query?.categorymembers ?? []) {
        members.push({ title: catMember.title, pageid: catMember.pageid });
      }

      continueParams = data.continue ?? {};
    } while (Object.keys(continueParams).length > 0);

    this.#log.info('fetchCategory', `${members.length.toString()} members in ${categoryName}`);
    return members;
  }

  /**
   * Enumerates all pages in the main namespace, paginating through continuation tokens.
   *
   * @param batchSize - Number of pages to request per API call (default 500).
   * @returns All page titles and IDs in the main namespace.
   * @throws {HttpError} When the API returns a non-OK response.
   */
  public async fetchAllPages(batchSize: number = DEFAULT_ALL_PAGES_LIMIT): FetchAllPagesResult {
    this.#log.info('fetchAllPages', 'Enumerating all pages in main namespace');
    const members: CategoryMemberType[] = [];
    let continueParams: Record<string, string> = {};

    do {
      const params = new URLSearchParams({
        action: 'query', list: 'allpages', apnamespace: '0',
        aplimit: batchSize.toString(), format: 'json',
        ...continueParams,
      });

      const data = await this.#limiter.schedule((): Promise<AllPagesResponseType> =>
        this.#policy.run((): Promise<AllPagesResponseType> =>
          this.#get<AllPagesResponseType>(params),
        ),
      );

      for (const pageEntry of data.query?.allpages ?? []) {
        members.push({ title: pageEntry.title, pageid: pageEntry.pageid });
      }

      continueParams = data.continue ?? {};
      this.#log.debug('fetchAllPages', `${members.length.toString()} pages so far`);
    } while (Object.keys(continueParams).length > 0);

    this.#log.info('fetchAllPages', `Total: ${members.length.toString()} pages`);
    return members;
  }

  private static wikitextOf(page: RevisionsPageType | undefined): string {
    const rev = page?.revisions?.[0];
    return rev?.['*'] ?? rev?.content ?? '';
  }

  async #get<T extends object>(params: URLSearchParams): Promise<T> {
    const url = `${this.#apiUrl}?${params.toString()}`;
    const res  = await fetch(url, { headers: this.#headers });
    if (!res.ok) throw HttpError.create(`MediaWiki API ${res.status.toString()}: ${url}`, { status: res.status, url });
    return res.json() as Promise<T>;
  }
}
