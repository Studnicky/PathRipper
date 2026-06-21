---
layout: doc
title: MediaWiki
---

# MediaWiki

Point Ripperoni at a MediaWiki API and it fetches pages in batches and hands you parsed wikitext. Set `apiUrl` in `state.json`, provide a `urls` list or a discovery mechanism in the orchestration, and Ripperoni handles the rest — no intermediary libraries, no browser.

An **infobox** is the structured data box (key-value pairs) MediaWiki wikis attach to articles — spells, monsters, items, and so on.

## Configuration

Set `apiUrl` in `state.json` to the MediaWiki Action API endpoint:

```json
{
  "apiUrl":      "https://example.org/w/api.php",
  "rateLimitMs": 500,
  "output":      { "basePath": "./output" },
  "cache":       { "dir": "./output/.cache/mywiki", "mode": "read-write" }
}
```

To enumerate a specific set of pages, list their titles in `urls`:

```json
{
  "apiUrl": "https://example.org/w/api.php",
  "urls":   ["Feats", "Spells", "Items"]
}
```

To enumerate a category or full wiki, add discovery logic to the orchestration DAG — author a node or embedded DAG that calls `MediaWikiScraper.fetchCategory` or `MediaWikiScraper.fetchAllPages` and seeds `state.urls`, then scatter over the result.

## Batch fetch

Pages are fetched in batches of up to 50 (MediaWiki's maximum). The API returns wikitext for all pages in one request — one rate-limit tick per batch. Rate limiting applies once per batch, not once per page.

Batch partial-failure behavior: If a batch request includes 50 page titles and one is a redirect or missing, the API returns the other 49 pages successfully. Pages that exist are returned; missing pages are silently omitted. Your parse task receives only the pages the API returned. If you expect 50 pages and get 49, something was missing or a redirect resolved to a different page title.

Redirect resolution: The API resolves redirects transparently. If page A redirects to page B, the API returns page B's content under the original page A title. The scraper receives the resolved content directly.

Rate limiting per batch: One API call fetches up to 50 pages, and the rate limiter counts it as one request. With `rateLimitMs: 500`, batch requests go out 500ms apart.

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

Plugins export a `register(dispatcher)` function. Nodes extend `ScalarNode` and return `NodeOutputBuilder.of(output)` — concept identity comes from the URL or a typed `<concept>_id` field on the output shape:

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

Cap the number of pages processed by setting `crawler.maxPages` in `state.json` when using a discovery flow, or by capping the `urls` list directly. Applied after enumeration; the scraper stops processing after this many pages regardless of how many the category or `allpages` enumeration returns. Useful for smoke tests against a full wiki without waiting for all 10,000 articles.

## Rate limiting and pagination

`rateLimitMs` and `jitterMs` from `state.json` apply per API request (each batch counts as one request). For a large wiki, expect a long run at conservative rates — but the cache covers pages already fetched; subsequent runs skip the network entirely for cached pages.

Pagination stop condition: The `fetchAllPages()` method pages through the entire namespace using the MediaWiki `allpages` API. It stops when the API returns an empty batch (no more pages in the namespace).

## Related

- [Scrapers](/usage/scrapers): `HtmlScraper` vs `MediaWikiScraper` comparison
- [Configuration](/usage/configuration): `apiUrl` and other `state.json` fields
- [Cache](/usage/cache): caching wiki responses
- [Plugins](/usage/plugins): full plugin authoring guide
