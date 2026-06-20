---
layout: doc
title: MediaWiki
---

# MediaWiki

Ripperoni hits the MediaWiki JSON API directly. No mwn, no axios, no browser. Three enumeration modes depending on what your config says.

## Three enumeration modes

Problem being solved: Different wikis have different structures. Some have a flat list of all articles (enumerate via `allpages`). Some organize content in categories (enumerate via `categorymembers`). Some have both. The runner needs to support all three modes without requiring you to rewrite your config each time.

Decision tree: `runWiki` picks the mode based on what's present in your config or CLI:

1. **`--category` CLI flag**: scrape one named category (overrides config).
2. **`categories[]` in config**: iterate each category, deduplicate page titles across all categories, scrape the union.
3. **Neither**: enumerate every article in main namespace via `fetchAllPages()`.

This ordering means: a CLI flag overrides config (don't allow config to force a full-wiki scrape if you wanted a single category). If config has `categories`, use them (don't hit the full wiki). Otherwise, fall back to full wiki.

```json
{
  "mediawiki": {
    "mywiki": {
      "apiUrl":      "https://example.org/w/api.php",
      "rateLimitMs": 500,
      "batchSize":   50,
      "pipeline":    ["mywiki:parse", "json:write"]
    }
  }
}
```

With `categories`:

```json
{
  "mediawiki": {
    "mywiki": {
      "apiUrl":     "https://example.org/w/api.php",
      "categories": ["Feats", "Spells", "Items"],
      "pipeline":   ["mywiki:parse", "json:write"]
    }
  }
}
```

## Batch fetch

Pages are fetched in batches of up to `batchSize` (default 50, MediaWiki's maximum). The API returns wikitext for all pages in one request. Rate limiting applies once per batch, not once per page.

Batch partial-failure behavior: If a batch request includes 50 page titles and one of them is a redirect or missing, the API returns the other 49 pages successfully. There's no explicit "failed pages" list; pages that exist are returned, missing pages are silently omitted. Your parse task receives only the pages that the API returned. If you're expecting 50 pages and get 49, something was missing or a redirect resolved to a different page title.

Redirect resolution: The API resolves redirects transparently. If page A is a redirect to page B, the API returns page B's content under the original page A title in the request. The scraper doesn't know a redirect happened; it just gets the content. This is why `maxPages` stops after this many distinct titles are scraped, not after this many API requests; 50 pages in one batch might resolve to 49 unique pages if one was a redirect.

Rate limiting per batch: Even though one API call fetches 50 pages, the rate limiter counts it as one request. If `rateLimitMs: 500`, you issue batch requests 500ms apart. Filling 1000 pages in batches of 50 means 20 batch requests, each separated by 500ms, for a total of ~10 seconds (ignoring any retry delays).

## WikitextParser

Wikitext is parsed via `wtf_wikipedia`. Your plugin receives a `ParsedPageInterface` in `state.input.parsedPage`:

```ts
interface ParsedPageInterface {
  title:    string;
  infobox:  Record<string, string>;  // flat key→value from the infobox
  sections: Array<{ title: string; wikitext: string }>;
  categories: string[];
}
```

Two typed accessor methods so you don't write null-checks at every call site:

```ts
// infoboxField(key); returns string | null
const name = parser.infoboxField('name');

// infoboxNumber(key); parses and returns number | null
const level = parser.infoboxNumber('level');
```

Worked examples:

```ts
// infoboxField returns the value from the infobox, or null
const name = page.infobox['name'];  // might be undefined; use ?? for default
const level = parseInt(page.infobox['level'] ?? '', 10) || null;

// Fallback to page title if no infobox name
const displayName = page.infobox['name'] ?? page.title;
```

These live on `WikitextParser`. In a plugin, use `state.input.parsedPage` directly; it's already been parsed before your task runs.

## Plugin pattern for MediaWiki

Plugins export a `register(dispatcher)` function. Nodes set `state.output` to a plain object — concept identity comes from the URL or a typed `<concept>_id` field on the output shape, not from a discriminator property:

```ts
import type { NodeInterface } from '@studnicky/dagonizer';
import type { ScrapeState }    from 'ripperoni/state/ScrapeState';
import type { RipperServices } from 'ripperoni/services/RipperServices';
import type { RipperDagonizer } from 'ripperoni/dispatcher/RipperDagonizer';

export const mywikiParseNode: NodeInterface<ScrapeState, 'success' | 'error', RipperServices> = {
  name:    'mywiki:parse',
  outputs: ['success', 'error'],
  async execute(state) {
    const wikitext = state.page.wikitext ?? '';
    if (wikitext.length === 0) return { output: 'error' };

    const title = state.page.title;
    const url   = state.page.url;

    state.output = {
      url,
      title,
      level: parseInt(/* infobox field */ '', 10) || null,
    };

    return { output: 'success' };
  },
};

export function register(dispatcher: RipperDagonizer<ScrapeState>): void {
  dispatcher.registerNode(mywikiParseNode);
}
```

## maxPages

Cap the number of pages processed:

```json
"maxPages": 100
```

Applied after enumeration; the scraper stops processing after this many pages regardless of how many the category or `allpages` enumeration returns. Useful for smoke tests against a full wiki without waiting for all 10,000 articles.

## Rate limiting and pagination

`rateLimitMs` and `jitterMs` apply per API request (each batch counts as one request). For a large wiki, expect a long run at conservative rates. The cache is your friend; the first run is slow, subsequent runs skip the network entirely for cached pages.

Pagination stop condition: The `fetchAllPages()` method pages through the entire namespace using the MediaWiki `allpages` API. It stops when the API returns an empty batch (no more pages in the namespace). The batch is counted toward `maxPages`; if you set `maxPages: 100` and the API returns pages in batches of 50, you get one full batch (50 pages) and then the second batch stops because you've hit the limit. The runner stops calling `fetchAllPages()` once enough pages have been fetched.

`batchSize` worked example: If you set `batchSize: 50` and enumerate 1000 pages, that's 20 API requests, each with 50 page titles in the `titles` parameter. If you set `batchSize: 10`, that's 100 requests. Larger batches use less bandwidth and API calls but are riskier if a batch request times out (you lose more pages). The MediaWiki API caps individual requests at 50; Ripperoni respects that by clamping your config value.

## Related

- [Scrapers](./scrapers); HtmlScraper vs MediaWikiScraper comparison
- [Configuration](./configuration); full mediawiki config schema
- [Cache](./cache); caching wiki responses
- [Plugins](./plugins); full plugin authoring guide
