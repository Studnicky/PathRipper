import { load } from 'cheerio';
import type { Element } from 'domhandler';
import { Logger } from '../modules/logger/logger.js';
import { RateLimiter } from '../modules/http/rateLimiter.js';
import { RetryExecutor } from '../modules/http/retryExecutor.js';
import type { RetryConfigInterface } from '../modules/http/retryExecutor.js';

export interface LinkListerConfigInterface {
  readonly domain: RegExp;
  readonly target: RegExp;
  readonly delimiter: RegExp;
  readonly rateLimitMs?: number | undefined;
  readonly jitterMs?:    number | undefined;
  readonly maxPages?:    number | undefined;
  readonly retry?: RetryConfigInterface | undefined;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const DEFAULT_RATE_LIMIT_MS = 100;

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

  constructor(config: LinkListerConfigInterface) {
    this.#domain    = config.domain;
    this.#target    = config.target;
    this.#delimiter = config.delimiter;
    this.#maxPages  = config.maxPages ?? Number.POSITIVE_INFINITY;
    this.#log       = Logger.forComponent('LinkLister');
    this.#limiter   = new RateLimiter({ minTimeMs: config.rateLimitMs ?? DEFAULT_RATE_LIMIT_MS, jitterMs: config.jitterMs ?? 0 });
    this.#retry     = new RetryExecutor(config.retry);
  }

  async buildList(startUrls: ReadonlyArray<string>): Promise<string[]> {
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

  async #crawl(url: string): Promise<string[]> {
    if (this.#visited.has(url)) return [];
    if (this.#capReached())     return [];
    this.#visited.add(url);

    const html = await this.#limiter.schedule(() =>
      this.#retry.execute(() => fetch(url).then((r: Response) => r.text())),
    );

    const allLinks = LinkLister.extractLinks(html, url)
      .filter((l: string) => this.#domain.test(l))
      .filter((l: string) => this.#delimiter.test(l));

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
    $('a[href]').each((_i: number, el: Element) => {
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
