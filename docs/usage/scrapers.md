---
layout: doc
title: Scrapers
---

# Scrapers

Scrapers are how Ripperoni fetches raw source material — HTML pages or MediaWiki API responses — and hands the result to your plugin node. You do not call them directly; the dagonizer dispatcher (engine: `@studnicky/dagonizer`, wired up via `RipperServices`) fetches each page and places the result in `state.input` before your node runs.

Two scraper classes, one parser: `HtmlScraper` works the HTML side, handing you a Cheerio document to carve with; `MediaWikiScraper` works the API side, speaking structured wikitext directly. `WikitextParser` turns that wikitext into structured infobox, section, and category data.

## Choosing which to use

Use `HtmlScraper` (set `baseUrl` in `state.json`) when:
- The site serves HTML pages you want to scrape with CSS selectors.
- You need redirect handling, custom headers, or cookie-based auth.
- The content is in the HTML body, not behind a structured API.

Use `MediaWikiScraper` (set `apiUrl` in `state.json`) when:
- The target is a MediaWiki site (Wikipedia, Fandom wikis, internal wikis).
- You want structured wikitext parsing with infobox extraction.
- You need to enumerate a full wiki or specific categories.

## HtmlScraper

`import { HtmlScraper } from 'ripperoni/HtmlScraper'`

`HtmlScraper` works the HTML counter: it fetches static pages via native `fetch`, parses them with cheerio, and hands back a live handle to carve with. Rate limiting, jitter, caching, and retry classification are handled automatically — the gristle is trimmed before your plugin ever sees the cut.

### Creating an instance

```ts
const scraper = HtmlScraper.create({
  baseUrl:       'https://example.com',
  rateLimitMs:   250,
  jitterMs:      50,
  maxRetries:    3,
  retryBaseDelayMs: 500,
  retryMaxDelayMs:  30_000,
  headers:       { 'User-Agent': 'my-bot/1.0' },
  cache,         // optional ScraperCache
});
```

`HtmlScraper.create(config: HtmlScraperConfigType): HtmlScraper`

### fetchPage

```ts
async fetchPage(path: string): Promise<ScrapedPageType>
```

`path` is a URL path or full URL. When relative, it is joined to `baseUrl` with exactly one `/` separator. Returns:

```ts
type ScrapedPageType = {
  readonly url:  string;      // resolved URL that was fetched
  readonly $:    CheerioAPI;  // Cheerio document loaded from html
  readonly html: string;      // raw HTML body
};
```

Fetch state machine: (1) rate limiter delays if needed; (2) cache is checked — on a hit, return immediately (skip 3–5); (3) HTTP GET is issued with configured headers; (4) on error, `HttpRetryPolicy` classifies and retries if applicable; (5) on success, body is stored in cache and returned.

The dispatcher places a `ScrapedPageType` value into `state.input` before your plugin node runs. Cast it and use `$` directly:

```ts
const { $, url } = state.input as ScrapedPageType;
$('h1.title').first().text().trim();
```

Or load the raw HTML yourself:

```ts
import * as cheerio from 'cheerio';
const $ = cheerio.load(state.input['html'] as string);
```

For JS-rendered pages (single-page apps, lazy-loaded content): fetch via a headless driver (Playwright, Puppeteer), get the rendered HTML string, and feed it to `cheerio.load()`. `HtmlScraper` handles the static-page case; bring your own driver for the dynamic case.

### fetchText

```ts
async fetchText(path: string): Promise<string>
```

Convenience wrapper around `fetchPage` that returns only the raw HTML string.

### Retry behavior

Errors are classified into seven categories. Only four are retryable:

| Category | Trigger | Retryable | Rationale |
|----------|---------|-----------|-----------|
| `NETWORK` | `ECONNREFUSED`, `ECONNRESET`, `ENOTFOUND` | yes | Network layer is transient; the server might be back up |
| `TIMEOUT` | `ETIMEDOUT`, `ESOCKETTIMEDOUT` | yes | Timeout means the request got no response; server might recover |
| `THROTTLED` | HTTP 429 (reads `Retry-After`) | yes | Server is asking you to wait and retry; honoring this prevents IP bans |
| `TRANSIENT` | HTTP 5xx | yes | Server errors are temporary; the instance might recover or failover |
| `PERMANENT` | HTTP 4xx (except 429) | no | 400, 403, 404, 410 mean the request is malformed or the resource doesn't exist; retrying won't help |
| `VALIDATION` | `TypeError`, `SyntaxError` | no | Code or response parsing is broken; retrying won't fix it |
| `RESOURCE` | `ENOMEM`, `ENOSPC` | no | Machine is out of memory or disk; retrying will fail again |

On `THROTTLED`: if the server sends a `Retry-After` header, that value overrides the configured backoff delay. If the header is malformed, the exponential backoff curve is used as a fallback.

Retry config in `state.json`:

```json
"maxRetries":       3,
"retryBaseDelayMs": 500,
"retryMaxDelayMs":  30000
```

Worst-case latency: With `maxRetries: 3, baseDelayMs: 500, multiplier: 2, maxDelayMs: 30000`, a single URL can take: initial attempt + 500ms + attempt + 1000ms + attempt + 2000ms + attempt = ~3.5 seconds in the best case (all retries fail). If the server throttles with a high `Retry-After`, the wait is longer. Parallel scatter runs multiple URLs concurrently, so total time for N URLs is roughly `(N / concurrency) * maxLatency`.

---

## MediaWikiScraper

`import { MediaWikiScraper } from 'ripperoni/MediaWikiScraper'`

`MediaWikiScraper` works the API counter: it calls the MediaWiki JSON API directly via `fetch()` and returns meaty, structured wikitext. Batching, auto-pagination, rate limiting, caching, and retry are handled in one place.

### Creating an instance

`MediaWikiScraper.create` is async:

```ts
const scraper = await MediaWikiScraper.create({
  apiUrl:          'https://wiki.example.com/api.php',
  rateLimitMs:     1_000,
  jitterMs:        100,
  maxRetries:      3,
  retryBaseDelayMs: 500,
  retryMaxDelayMs:  30_000,
  cache,           // optional ScraperCache
});
```

`static async create(config: MediaWikiConfigType): Promise<MediaWikiScraper>`

### Methods

| Method | API call | Returns |
|--------|----------|---------|
| `fetchPage(title)` | `action=query&prop=revisions` (via batch) | `Promise<WikiPageType>` |
| `fetchPagesBatch(titles)` | `action=query&prop=revisions&titles=<pipe-delimited>` | `Promise<WikiPageType[]>` |
| `fetchCategory(name)` | `action=query&list=categorymembers` — auto-paginated | `Promise<CategoryMemberType[]>` |
| `fetchAllPages(batchSize?)` | `action=query&list=allpages` — auto-paginated | `Promise<CategoryMemberType[]>` |

`fetchPage` delegates to `fetchPagesBatch` internally; both are cache-aware.

`fetchAllPages` takes an optional `batchSize` argument (default `500`) controlling how many pages are requested per API call.

Return shapes:

```ts
type WikiPageType = {
  readonly title:    string;  // article title
  readonly wikitext: string;  // raw wikitext source
};

type CategoryMemberType = {
  readonly title:  string;  // article title
  readonly pageid: number;  // numeric MediaWiki page ID
};
```

What your plugin gets in `state.input` for a wiki scrape is a `WikiPageType`. Parse it with `WikitextParser`:

```ts
import { WikitextParser } from 'ripperoni/WikitextParser';
const { title, wikitext } = state.input as WikiPageType;
const parsed = WikitextParser.parse(title, wikitext);
```

### Rate limiting

Rate limit and jitter apply per API request, same as `HtmlScraper`. Batch requests count as one request toward the rate limit.

---

## WikitextParser

`import { WikitextParser } from 'ripperoni/WikitextParser'`

`WikitextParser` converts raw wikitext into structured infobox, section, and category data using `wtf_wikipedia`. All methods are static.

### parse

```ts
static parse(title: string, wikitext: string): ParsedPageType
```

```ts
type ParsedPageType = {
  readonly title:      string;
  readonly infobox:    Record<string, string | string[] | number | boolean | null>;
  readonly sections:   ReadonlyArray<{ readonly title: string; readonly text: string }>;
  readonly categories: readonly string[];
};
```

### infoboxField

```ts
static infoboxField(parsed: ParsedPageType, field: string): string | null
```

Returns the infobox field value as a string, or `null` if the field is absent.

### infoboxNumber

```ts
static infoboxNumber(parsed: ParsedPageType, field: string): number | null
```

Returns the infobox field value parsed as a finite number via `parseFloat`, or `null` if absent or non-numeric.

Usage:

```ts
const parsed = WikitextParser.parse(title, wikitext);
const cr   = WikitextParser.infoboxNumber(parsed, 'cr');    // number | null
const name = WikitextParser.infoboxField(parsed, 'name');   // string | null
```

---

## Related

- [Configuration](/usage/configuration): `baseUrl` and `apiUrl` in `state.json`
- [MediaWiki](/usage/mediawiki): enumeration modes, infobox helpers
- [Cache](/usage/cache): how caching integrates with both scrapers
- [Authoring a DAG](/usage/pipeline): how DAG steps become per-page nodes
- [Plugins](/usage/plugins): the node/state shape inside a parse node
