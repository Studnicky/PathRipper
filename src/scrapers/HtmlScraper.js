// Replaces PathRipper's JSDOM fetchPage with cheerio — lighter, no JS execution.
// For JS-rendered pages, swap the fetch() call for a headless browser driver.
import { load as cheerioLoad } from 'cheerio';
import { RateLimiter } from '../modules/http/RateLimiter.js';
import { RetryExecutor } from '../modules/http/RetryExecutor.js';
import { Logger } from '../modules/logger/Logger.js';
import { HttpError } from '../errors/HttpError.js';
export class HtmlScraper {
    #base;
    #headers;
    #limiter;
    #retry;
    #log;
    constructor(config) {
        this.#base = config.baseUrl;
        this.#headers = config.headers ?? {};
        this.#limiter = new RateLimiter({ minTimeMs: config.rateLimitMs ?? 250, jitterMs: config.jitterMs ?? 0 });
        this.#retry = new RetryExecutor(config.retry);
        this.#log = Logger.forComponent('HtmlScraper');
    }
    async fetchPage(path) {
        const url = path.startsWith('http') ? path : `${this.#base}${path}`;
        this.#log.debug('fetchPage', url);
        const html = await this.#limiter.schedule(() => this.#retry.execute(async () => {
            const res = await fetch(url, { headers: this.#headers });
            if (!res.ok) {
                throw new HttpError(`HTTP ${res.status.toString()} ${url}`, { status: res.status, url });
            }
            return res.text();
        }));
        return { url, $: cheerioLoad(html), html };
    }
    async fetchText(path) {
        const { html } = await this.fetchPage(path);
        return html;
    }
}
