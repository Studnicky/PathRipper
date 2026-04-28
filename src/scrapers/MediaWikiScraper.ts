import { Mwn, type ApiPage } from 'mwn';
import { RateLimiter } from '../modules/http/RateLimiter.js';
import { Logger } from '../modules/logger/Logger.js';

export interface MediaWikiConfigInterface {
  readonly apiUrl: string;
  readonly userAgent: string;
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

interface CategoryMembersResponseInterface {
  readonly query?: {
    readonly categorymembers?: ReadonlyArray<CategoryMemberShapeInterface>;
  };
}

const BATCH_SIZE = 50;

export class MediaWikiScraper {
  readonly #bot: Mwn;
  readonly #limiter: RateLimiter;
  readonly #log: Logger;

  private constructor(bot: Mwn, limiter: RateLimiter) {
    this.#bot     = bot;
    this.#limiter = limiter;
    this.#log     = Logger.forComponent('MediaWikiScraper');
  }

  static async create(config: MediaWikiConfigInterface): Promise<MediaWikiScraper> {
    const bot = new Mwn({
      apiUrl:    config.apiUrl,
      userAgent: config.userAgent,
      silent:    true,
    });
    const limiter = new RateLimiter({ minTimeMs: config.rateLimitMs ?? 1_000, jitterMs: config.jitterMs ?? 0 });
    return new MediaWikiScraper(bot, limiter);
  }

  async fetchPage(title: string): Promise<WikiPageInterface> {
    this.#log.debug('fetchPage', title);
    return this.#limiter.schedule(async () => {
      const page = await this.#bot.read(title);
      return { title, wikitext: MediaWikiScraper.wikitextOf(page) };
    });
  }

  async fetchPagesBatch(titles: string[]): Promise<WikiPageInterface[]> {
    this.#log.debug('fetchPagesBatch', `${titles.length.toString()} pages`);
    if (titles.length === 0) return [];

    return this.#limiter.schedule(async () => {
      const pages = await this.#bot.read(titles);
      return pages.map((p): WikiPageInterface => ({
        title:    p.title,
        wikitext: MediaWikiScraper.wikitextOf(p),
      }));
    });
  }

  async fetchCategory(categoryName: string): Promise<CategoryMemberInterface[]> {
    this.#log.info('fetchCategory', categoryName);
    const members: CategoryMemberInterface[] = [];

    const gen = this.#bot.continuedQueryGen({
      action:  'query',
      list:    'categorymembers',
      cmtitle: `Category:${categoryName}`,
      cmlimit: 500,
      cmtype:  'page',
    }) as AsyncGenerator<CategoryMembersResponseInterface>;

    for await (const batch of gen) {
      const list = batch.query?.categorymembers ?? [];
      for (const m of list) {
        members.push({ title: m.title, pageid: m.pageid });
      }
    }

    this.#log.info('fetchCategory', `${members.length.toString()} members in ${categoryName}`);
    return members;
  }

  async scrapeCategory(categoryName: string): Promise<WikiPageInterface[]> {
    const members = await this.fetchCategory(categoryName);
    const titles  = members.map((m) => m.title);
    const pages: WikiPageInterface[] = [];

    for (let i = 0; i < titles.length; i += BATCH_SIZE) {
      const slice = titles.slice(i, i + BATCH_SIZE);
      const batch = await this.fetchPagesBatch(slice);
      pages.push(...batch);
      this.#log.debug('scrapeCategory', `Fetched ${pages.length.toString()}/${titles.length.toString()}`);
    }

    return pages;
  }

  private static wikitextOf(page: ApiPage): string {
    return page.revisions?.[0]?.content ?? '';
  }
}
