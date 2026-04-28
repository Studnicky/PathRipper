import { HttpError } from '../errors/HttpError.js';
import { RateLimiter } from '../modules/http/rateLimiter.js';
import { Logger } from '../modules/logger/logger.js';

export interface MediaWikiConfigInterface {
  readonly apiUrl: string;
  readonly rateLimitMs?: number | undefined;
  readonly jitterMs?:    number | undefined;
}

export interface WikiPageInterface {
  readonly title: string;
  readonly wikitext: string;
}

export interface CategoryMemberInterface {
  readonly title: string;
  readonly pageid: number;
}

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

export class MediaWikiScraper {
  readonly #apiUrl:   string;
  readonly #headers:  Readonly<Record<string, string>>;
  readonly #limiter:  RateLimiter;
  readonly #log:      Logger;

  private constructor(config: MediaWikiConfigInterface) {
    this.#apiUrl  = config.apiUrl;
    this.#headers = { 'Accept': 'application/json, */*' };
    this.#limiter = new RateLimiter({ minTimeMs: config.rateLimitMs ?? DEFAULT_RATE_LIMIT_MS, jitterMs: config.jitterMs ?? 0 });
    this.#log     = Logger.forComponent('MediaWikiScraper');
  }

  public static async create(config: MediaWikiConfigInterface): Promise<MediaWikiScraper> {
    return new MediaWikiScraper(config);
  }

  public async fetchPage(title: string): Promise<WikiPageInterface> {
    this.#log.debug('fetchPage', title);
    return this.#limiter.schedule(async () => {
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

  public async fetchPagesBatch(titles: string[]): Promise<WikiPageInterface[]> {
    this.#log.debug('fetchPagesBatch', `${titles.length.toString()} pages`);
    if (titles.length === 0) return [];

    return this.#limiter.schedule(async () => {
      const params = new URLSearchParams({
        action: 'query', titles: titles.join('|'), prop: 'revisions',
        rvprop: 'content', format: 'json',
      });
      const data = await this.#get<RevisionsResponseInterface>(params);
      return Object.values(data.query?.pages ?? {}).map((p: RevisionsPageInterface) => ({
        title:    p.title,
        wikitext: MediaWikiScraper.wikitextOf(p),
      }));
    });
  }

  public async fetchCategory(categoryName: string): Promise<CategoryMemberInterface[]> {
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

      const data = await this.#limiter.schedule(() =>
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

  public async fetchAllPages(batchSize: number = API_ALL_PAGES_LIMIT): Promise<CategoryMemberInterface[]> {
    this.#log.info('fetchAllPages', 'Enumerating all pages in main namespace');
    const members: CategoryMemberInterface[] = [];
    let continueParams: Record<string, string> = {};

    do {
      const params = new URLSearchParams({
        action: 'query', list: 'allpages', apnamespace: '0',
        aplimit: batchSize.toString(), format: 'json',
        ...continueParams,
      });

      const data = await this.#limiter.schedule(() =>
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

  public async scrapeCategory(categoryName: string): Promise<WikiPageInterface[]> {
    const members = await this.fetchCategory(categoryName);
    const titles  = members.map((m: CategoryMemberInterface) => m.title);
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
    if (!res.ok) throw new HttpError(`MediaWiki API ${res.status.toString()}: ${url}`, { status: res.status, url });
    return res.json() as Promise<T>;
  }
}
