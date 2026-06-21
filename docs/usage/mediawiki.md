---
layout: doc
title: MediaWiki
---

# MediaWiki

Point Ripperoni at a MediaWiki API and it determines which pages to pull, fetches them in batches, and hands you parsed wikitext. Provide an `apiUrl`, choose an enumeration mode, and Ripperoni handles the rest — no intermediary libraries, no browser. The mode-selection and fetch sequence run as an embedded DAG powered by `@studnicky/dagonizer`.

An **infobox** is the structured data box (key-value pairs) MediaWiki wikis attach to articles — spells, monsters, items, and so on. **Member resolution** is the step that resolves which page titles belong to a category before fetching begins.

## Four enumeration modes

`ChooseModeNode` (inside `wikiResolveMembersDAG`) picks one of four modes in priority order:

1. **`resumeFailures` flag**: re-scrape titles from `failures.json` (set via CLI `--resume-failures`).
2. **`--category` CLI flag**: scrape one named category (overrides config).
3. **`categories[]` in config**: iterate each category, deduplicate page titles across all categories, scrape the union.
4. **Neither**: enumerate every article in main namespace via `fetchAllPages()`.

Resume-failures takes precedence over everything. A CLI `--category` flag overrides config. Config `categories` target specific categories. With none of those set, the runner enumerates the full wiki.

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

Pages are fetched in batches of up to `batchSize` (default 50, MediaWiki's maximum). The API returns wikitext for all pages in one request — one rate-limit tick per batch. Rate limiting applies once per batch, not once per page.

Batch partial-failure behavior: If a batch request includes 50 page titles and one is a redirect or missing, the API returns the other 49 pages successfully. Pages that exist are returned; missing pages are silently omitted. Your parse task receives only the pages the API returned. If you expect 50 pages and get 49, something was missing or a redirect resolved to a different page title.

Redirect resolution: The API resolves redirects transparently. If page A redirects to page B, the API returns page B's content under the original page A title. The scraper receives the resolved content directly. This is why `maxPages` counts distinct titles scraped, not API requests — 50 pages in one batch may yield 49 unique pages if one was a redirect.

Rate limiting per batch: One API call fetches 50 pages, and the rate limiter counts it as one request. With `rateLimitMs: 500`, batch requests go out 500ms apart. Fetching 1000 pages in batches of 50 means 20 batch requests, each separated by 500ms — ~10 seconds total, ignoring retry delays.

## WikitextParser

Wikitext is parsed via `wtf_wikipedia`. The `ParsedPageType` produced by `WikitextParser.parse` has:

```ts
type ParsedPageType = {
  title:      string;
  infobox:    Record<string, string | string[] | number | boolean | null>;
  sections:   ReadonlyArray<{ title: string; text: string }>;
  categories: readonly string[];
};
```

Two static accessor methods handle null-safety at the call site:

```ts
// WikitextParser.infoboxField(parsed, key) returns string | null
const name = WikitextParser.infoboxField(parsed, 'name');

// WikitextParser.infoboxNumber(parsed, key) parses and returns number | null
const level = WikitextParser.infoboxNumber(parsed, 'level');
```

Worked examples:

```ts
// Direct infobox access — value may be undefined
const name = parsed.infobox['name'];

// Fallback to page title if no infobox name
const displayName = WikitextParser.infoboxField(parsed, 'name') ?? parsed.title;

// Numeric field with null fallback
const level = WikitextParser.infoboxNumber(parsed, 'level');
```

All methods live on `WikitextParser` as static members. In a plugin node, call `WikitextParser.parse(state.page.title, state.page.wikitext ?? '')` at the start of your `executeOne` method to obtain the `ParsedPageType`.

## Plugin pattern for MediaWiki

Plugins export a `register(dispatcher)` function. Nodes extend `ScalarNode` and return `NodeOutputBuilder.of(output)` — concept identity comes from the URL or a typed `<concept>_id` field on the output shape, not from a discriminator property:

```ts
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';
import { WikitextParser }  from 'ripperoni/scrapers/WikitextParser';
import type { ScrapeState }    from 'ripperoni/state/ScrapeState';
import type { RipperServices } from 'ripperoni/services/RipperServices';
import type { RipperDagonizer } from 'ripperoni/dispatcher/RipperDagonizer';

type ParseOutput = 'success' | 'error';

class MywikiParseNodeImpl extends ScalarNode<ScrapeState, ParseOutput, RipperServices> {
  public readonly name    = 'mywiki:parse';
  public readonly outputs = ['success', 'error'] as const;

  protected override async executeOne(
    state:   ScrapeState,
    _ctx:    NodeContextType<RipperServices>,
  ): Promise<NodeOutputType<ParseOutput>> {
    const wikitext = state.page.wikitext ?? '';
    if (wikitext.length === 0) return NodeOutputBuilder.of('error');

    const parsed = WikitextParser.parse(state.page.title, wikitext);

    state.output = {
      url:   state.page.url,
      title: parsed.title,
      level: WikitextParser.infoboxNumber(parsed, 'level'),
    };

    return NodeOutputBuilder.of('success');
  }
}

export const MywikiParseNode = new MywikiParseNodeImpl();

export function register(dispatcher: RipperDagonizer<ScrapeState>): void {
  dispatcher.registerNode(MywikiParseNode);
}
```

## maxPages

Cap the number of pages processed:

```json
"maxPages": 100
```

Applied after enumeration; the scraper stops processing after this many pages regardless of how many the category or `allpages` enumeration returns. Useful for smoke tests against a full wiki without waiting for all 10,000 articles.

## Rate limiting and pagination

`rateLimitMs` and `jitterMs` apply per API request (each batch counts as one request). For a large wiki, expect a long run at conservative rates — but the cache covers pages already fetched; subsequent runs skip the network entirely for cached pages.

Pagination stop condition: The `fetchAllPages()` method pages through the entire namespace using the MediaWiki `allpages` API. It stops when the API returns an empty batch (no more pages in the namespace). The batch counts toward `maxPages`; with `maxPages: 100` and batches of 50, you get one full batch (50 pages) and the second batch stops at the limit.

`batchSize` worked example: With `batchSize: 50` and 1000 pages to enumerate, that's 20 API requests, each with 50 page titles in the `titles` parameter. With `batchSize: 10`, that's 100 requests. Larger batches use fewer API calls but risk losing more pages if a batch request times out. The MediaWiki API caps individual requests at 50; Ripperoni clamps your config value to that ceiling.

## Related

- [Scrapers](./scrapers); HtmlScraper vs MediaWikiScraper comparison
- [Configuration](./configuration); full mediawiki config schema
- [Cache](./cache); caching wiki responses
- [Plugins](./plugins); full plugin authoring guide
