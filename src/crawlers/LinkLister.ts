// Modernized from PathRipper/src/linkLister/index.js
// Recursive page crawler — domain/target/delimiter fully configurable.

import { load as cheerioLoad } from 'cheerio';
import { Logger } from '../modules/logger/Logger.js';
import { RateLimiter } from '../modules/http/RateLimiter.js';
import { RetryExecutor } from '../modules/http/RetryExecutor.js';
import type { RetryConfigInterface } from '../modules/http/RetryExecutor.js';

export interface LinkListerConfigInterface {
  readonly domain: RegExp;
  readonly target: RegExp;
  readonly delimiter: RegExp;
  readonly rateLimitMs?: number | undefined;
  readonly retry?: RetryConfigInterface | undefined;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function extractLinks(html: string, baseUrl: string): string[] {
  const $ = cheerioLoad(html);
  const links: string[] = [];

  $('a[href]').each((_i, el) => {
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

export class LinkLister {
  readonly #domain: RegExp;
  readonly #target: RegExp;
  readonly #delimiter: RegExp;
  readonly #visited   = new Set<string>();
  readonly #collected = new Set<string>();
  readonly #log: Logger;
  readonly #limiter: RateLimiter;
  readonly #retry: RetryExecutor;

  constructor(config: LinkListerConfigInterface) {
    this.#domain    = config.domain;
    this.#target    = config.target;
    this.#delimiter = config.delimiter;
    this.#log       = Logger.forComponent('LinkLister');
    this.#limiter   = RateLimiter.withDelay(config.rateLimitMs ?? 100);
    this.#retry     = new RetryExecutor(config.retry);
  }

  async buildList(startUrl: string): Promise<string[]> {
    this.#log.debug('buildList', `Starting crawl from ${startUrl}`);
    const results = await this.#crawl(startUrl);
    const sorted  = results.sort(collator.compare);
    this.#log.info('buildList', `Found ${sorted.length.toString()} matching links`);
    return sorted;
  }

  async #crawl(url: string): Promise<string[]> {
    if (this.#visited.has(url)) return [];
    this.#visited.add(url);

    const html = await this.#limiter.schedule(() =>
      this.#retry.execute(() => fetch(url).then((r) => r.text())),
    );

    const allLinks = extractLinks(html, url)
      .filter((l) => this.#domain.test(l))
      .filter((l) => this.#delimiter.test(l));

    const targets:    string[] = [];
    const traversals: string[] = [];

    for (const link of allLinks) {
      if (this.#target.test(link)) {
        if (this.#collected.has(link)) continue;
        this.#collected.add(link);
        targets.push(link);
      } else if (!this.#visited.has(link)) {
        traversals.push(link);
      }
    }

    this.#log.debug('buildList', `${url} → ${targets.length.toString()} targets, ${traversals.length.toString()} to traverse`);

    const nested = await Promise.all(traversals.map((l) => this.#crawl(l)));
    return [...targets, ...nested.flat()];
  }
}
