/**
 * Unit tests for HtmlScraper JSDOM mode.
 *
 * Verifies that when `useJsdom: true` is set, fetched HTML is processed through
 * JSDOM before cheerio parsing — enabling synchronous script execution and DOM
 * mutation — while the returned `ScrapedPageType` contract remains unchanged.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { HtmlScraper } from '../../../src/scrapers/HtmlScraper.js';

const realFetch = globalThis.fetch;

/** HTML page with an inline script that sets document.title via DOM mutation. */
const PAGE_WITH_SCRIPT = `<!DOCTYPE html>
<html>
<head><title>Original Title</title></head>
<body>
<h1>Hello</h1>
<script>document.title = 'Mutated Title';</script>
</body>
</html>`;

describe('HtmlScraper — JSDOM mode', () => {
  before(() => {
    globalThis.fetch = (async (_url: string | URL): Promise<Response> => {
      return new Response(PAGE_WITH_SCRIPT, { status: 200 });
    }) as typeof fetch;
  });

  after(() => {
    globalThis.fetch = realFetch;
  });

  it('returns mutated title in html when useJsdom is true and script sets document.title', async () => {
    const scraper = HtmlScraper.create({
      baseUrl:     'https://example.com',
      rateLimitMs: 0,
      useJsdom:    true,
    });

    const result = await scraper.fetchPage('/page');

    // JSDOM executes the inline script which sets document.title to 'Mutated Title'.
    // dom.serialize() should reflect the DOM mutation in the <title> element.
    assert.match(result.html, /Mutated Title/, 'serialized html must reflect DOM mutation from inline script');
    assert.equal(result.url, 'https://example.com/page');

    // Cheerio $ must work on the processed html.
    const title = result.$('title').text();
    assert.equal(title, 'Mutated Title', 'cheerio must parse the JSDOM-serialized html');
  });

  it('returns original html when useJsdom is false (default path)', async () => {
    const scraper = HtmlScraper.create({
      baseUrl:     'https://example.com',
      rateLimitMs: 0,
    });

    const result = await scraper.fetchPage('/page');

    // Without JSDOM the script is not executed; the original title stays.
    const title = result.$('title').text();
    assert.equal(title, 'Original Title', 'cheerio must see the unmodified title without JSDOM');
  });
});
