import type { FetchPageResult, FetchPagesBatchResult, FetchCategoryResult, FetchAllPagesResult, ScrapeCategoryResult } from '../types/Results.js';
import { HttpError } from '../errors/HttpError.js';
import { RateLimiter } from '../modules/http/rateLimiter.js';
import { Logger } from '../modules/logger/logger.js';
import type {
  MediaWikiConfigInterface,
  WikiPageInterface,
  CategoryMemberInterface,
} from '../types/MediaWikiScraper.js';

export type { MediaWikiConfigInterface, WikiPageInterface, CategoryMemberInterface };

interface CategoryMemberShapeInterface {
  readonly title: string;
  readonly pageid: number;
}

interface AllPagesResponseInterface {
  readonly query?: {
    readonly allpages?: ReadonlyArray<{ readonly title: string; readonly pageid: number }>;
  };
  readonly continue?: Record<string, string>;
}

interface CategoryMembersResponseInterface {
  readonly query?: {
    readonly categorymembers?: ReadonlyArray<CategoryMemberShapeInterface>;
  };
  readonly continue?: Record<string, string>;
}

interface RevisionsPageInterface {
  readonly title:     string;
  readonly pageid?:   number;
  readonly missing?:  true;
  readonly revisions?: ReadonlyArray<{
    readonly '*'?:     string;  // formatversion 1 — content here
    readonly content?: string;  // formatversion 2 fallback
  }>;
}

interface RevisionsResponseInterface {
  readonly query?: {
    readonly pages?: Record<string, RevisionsPageInterface>;
  };
}

const BATCH_SIZE               = 50;
const API_CATEGORY_LIMIT       = 500;
const API_ALL_PAGES_LIMIT      = 500;
const DEFAULT_RATE_LIMIT_MS    = 1_000;

/** Fetches wikitext content and category membership from a MediaWiki action API. */
export class MediaWikiScraper {
  readonly #apiUrl:   string;
  readonly #headers:  Readonly<Record<string, string>>;
  readonly #limiter:  RateLimiter;
  readonly #log:      Logger;

  /**
   * @param config - MediaWiki API URL and optional rate-limit settings.
   */
  private constructor(config: MediaWikiConfigInterface) {
    this.#apiUrl  = config.apiUrl;
    this.#headers = { 'Accept': 'application/json, */*' };
    this.#limiter = RateLimiter.create({ minTimeMs: config.rateLimitMs ?? DEFAULT_RATE_LIMIT_MS, jitterMs: config.jitterMs ?? 0 });
    this.#log     = Logger.forComponent('MediaWikiScraper');
  }

  /**
   * Creates a MediaWikiScraper instance.
   *
   * @param config - MediaWiki configuration.
   * @returns A new MediaWikiScraper.
   */
  public static async create(config: MediaWikiConfigInterface): Promise<MediaWikiScraper> {
    return new MediaWikiScraper(config);
  }

  /**
   * Fetches the wikitext content of a single article.
   *
   * @param title - Article title to fetch.
   * @returns Wiki page with title and wikitext content.
   * @throws {HttpError} When the API returns a non-OK response.
   */
  public async fetchPage(title: string): FetchPageResult {
    this.#log.debug('fetchPage', title);
    return this.#limiter.schedule(async (): Promise<WikiPageInterface> => {
      const params = new URLSearchParams({
        action: 'query', titles: title, prop: 'revisions',
        rvprop: 'content', format: 'json',
      });
      const data = await this.#get<RevisionsResponseInterface>(params);
      const pages = Object.values(data.query?.pages ?? {});
      const page  = pages[0];
      return { title, wikitext: MediaWikiScraper.wikitextOf(page) };
    });
  }

  /**
   * Fetches wikitext for multiple articles in a single API request.
   *
   * @param titles - Array of article titles to fetch.
   * @returns Array of wiki pages with title and wikitext content.
   * @throws {HttpError} When the API returns a non-OK response.
   */
  public async fetchPagesBatch(titles: string[]): FetchPagesBatchResult {
    this.#log.debug('fetchPagesBatch', `${titles.length.toString()} pages`);
    if (titles.length === 0) return [];

    return this.#limiter.schedule(async (): Promise<WikiPageInterface[]> => {
      const params = new URLSearchParams({
        action: 'query', titles: titles.join('|'), prop: 'revisions',
        rvprop: 'content', format: 'json',
      });
      const data = await this.#get<RevisionsResponseInterface>(params);
      return Object.values(data.query?.pages ?? {}).map((p: RevisionsPageInterface): WikiPageInterface => ({
        title:    p.title,
        wikitext: MediaWikiScraper.wikitextOf(p),
      }));
    });
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
    const members: CategoryMemberInterface[] = [];
    let continueParams: Record<string, string> = {};

    do {
      const params = new URLSearchParams({
        action:  'query', list: 'categorymembers',
        cmtitle: `Category:${categoryName}`,
        cmlimit: API_CATEGORY_LIMIT.toString(), cmtype: 'page', format: 'json',
        ...continueParams,
      });

      const data = await this.#limiter.schedule((): Promise<CategoryMembersResponseInterface> =>
        this.#get<CategoryMembersResponseInterface>(params),
      );

      for (const m of data.query?.categorymembers ?? []) {
        members.push({ title: m.title, pageid: m.pageid });
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
  public async fetchAllPages(batchSize: number = API_ALL_PAGES_LIMIT): FetchAllPagesResult {
    this.#log.info('fetchAllPages', 'Enumerating all pages in main namespace');
    const members: CategoryMemberInterface[] = [];
    let continueParams: Record<string, string> = {};

    do {
      const params = new URLSearchParams({
        action: 'query', list: 'allpages', apnamespace: '0',
        aplimit: batchSize.toString(), format: 'json',
        ...continueParams,
      });

      const data = await this.#limiter.schedule((): Promise<AllPagesResponseInterface> =>
        this.#get<AllPagesResponseInterface>(params),
      );

      for (const p of data.query?.allpages ?? []) {
        members.push({ title: p.title, pageid: p.pageid });
      }

      continueParams = data.continue ?? {};
      this.#log.debug('fetchAllPages', `${members.length.toString()} pages so far`);
    } while (Object.keys(continueParams).length > 0);

    this.#log.info('fetchAllPages', `Total: ${members.length.toString()} pages`);
    return members;
  }

  /**
   * Fetches all pages in a category, batching wikitext requests for efficiency.
   *
   * @param categoryName - Category name without the `Category:` prefix.
   * @returns All wiki pages in the category with their wikitext content.
   * @throws {HttpError} When the API returns a non-OK response.
   */
  public async scrapeCategory(categoryName: string): ScrapeCategoryResult {
    const members = await this.fetchCategory(categoryName);
    const titles  = members.map((m: CategoryMemberInterface): string => m.title);
    const pages: WikiPageInterface[] = [];

    for (let i = 0; i < titles.length; i += BATCH_SIZE) {
      const slice = titles.slice(i, i + BATCH_SIZE);
      const batch = await this.fetchPagesBatch(slice);
      pages.push(...batch);
      this.#log.debug('scrapeCategory', `Fetched ${pages.length.toString()}/${titles.length.toString()}`);
    }

    return pages;
  }

  private static wikitextOf(page: RevisionsPageInterface | undefined): string {
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
