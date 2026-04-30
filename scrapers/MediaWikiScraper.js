import { HttpError } from '../errors/HttpError.js';
import { RateLimiter } from '../modules/http/RateLimiter.js';
import { Logger } from '../modules/logger/Logger.js';
const BATCH_SIZE = 50;
export class MediaWikiScraper {
    #apiUrl;
    #headers;
    #limiter;
    #log;
    constructor(config) {
        this.#apiUrl = config.apiUrl;
        this.#headers = { 'Accept': 'application/json, */*' };
        this.#limiter = new RateLimiter({ minTimeMs: config.rateLimitMs ?? 1_000, jitterMs: config.jitterMs ?? 0 });
        this.#log = Logger.forComponent('MediaWikiScraper');
    }
    static async create(config) {
        return new MediaWikiScraper(config);
    }
    async fetchPage(title) {
        this.#log.debug('fetchPage', title);
        return this.#limiter.schedule(async () => {
            const params = new URLSearchParams({
                action: 'query', titles: title, prop: 'revisions',
                rvprop: 'content', format: 'json',
            });
            const data = await this.#get(params);
            const pages = Object.values(data.query?.pages ?? {});
            const page = pages[0];
            return { title, wikitext: MediaWikiScraper.wikitextOf(page) };
        });
    }
    async fetchPagesBatch(titles) {
        this.#log.debug('fetchPagesBatch', `${titles.length.toString()} pages`);
        if (titles.length === 0)
            return [];
        return this.#limiter.schedule(async () => {
            const params = new URLSearchParams({
                action: 'query', titles: titles.join('|'), prop: 'revisions',
                rvprop: 'content', format: 'json',
            });
            const data = await this.#get(params);
            return Object.values(data.query?.pages ?? {}).map((p) => ({
                title: p.title,
                wikitext: MediaWikiScraper.wikitextOf(p),
            }));
        });
    }
    async fetchCategory(categoryName) {
        this.#log.info('fetchCategory', categoryName);
        const members = [];
        let continueParams = {};
        do {
            const params = new URLSearchParams({
                action: 'query', list: 'categorymembers',
                cmtitle: `Category:${categoryName}`,
                cmlimit: '500', cmtype: 'page', format: 'json',
                ...continueParams,
            });
            const data = await this.#limiter.schedule(() => this.#get(params));
            for (const m of data.query?.categorymembers ?? []) {
                members.push({ title: m.title, pageid: m.pageid });
            }
            continueParams = data.continue ?? {};
        } while (Object.keys(continueParams).length > 0);
        this.#log.info('fetchCategory', `${members.length.toString()} members in ${categoryName}`);
        return members;
    }
    async scrapeCategory(categoryName) {
        const members = await this.fetchCategory(categoryName);
        const titles = members.map((m) => m.title);
        const pages = [];
        for (let i = 0; i < titles.length; i += BATCH_SIZE) {
            const slice = titles.slice(i, i + BATCH_SIZE);
            const batch = await this.fetchPagesBatch(slice);
            pages.push(...batch);
            this.#log.debug('scrapeCategory', `Fetched ${pages.length.toString()}/${titles.length.toString()}`);
        }
        return pages;
    }
    static wikitextOf(page) {
        const rev = page?.revisions?.[0];
        return rev?.['*'] ?? rev?.content ?? '';
    }
    async #get(params) {
        const url = `${this.#apiUrl}?${params.toString()}`;
        const res = await fetch(url, { headers: this.#headers });
        if (!res.ok)
            throw new HttpError(`MediaWiki API ${res.status.toString()}: ${url}`, { status: res.status, url });
        return res.json();
    }
}
