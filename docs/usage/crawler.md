---
layout: doc
title: Crawler
---

# Crawler

`LinkLister` recursively follows links from one or more starting URLs and returns the set of URLs that match your target pattern. It doesn't scrape content; it builds a URL list. You hand that list to a scraper.

## Three regexes

Problem being solved: You want to crawl a site to build a URL list for scraping, but you don't want the crawler to follow every link it encounters. You want it to traverse category pages (to find all items) but only collect individual item pages (the URLs you'll scrape). Three regexes give you fine-grained control over both traversal and collection.

Three-regex decision tree: For each link the crawler finds, it applies three filters in order:

1. **Domain filter**: Does the link match `domain`? If no, ignore it entirely (don't traverse, don't collect).
2. **Delimiter filter**: Does the link match `domain` AND `delimiter`? If yes, add it to the frontier (traverse it). If no, skip it (don't follow).
3. **Target filter**: Does the link match `domain` AND `delimiter` AND `target`? If yes, add it to the results. If no, ignore it (traverse it but don't collect).

```json
{
  "crawlers": {
    "aonprd-feats": {
      "startUrls": ["https://2e.aonprd.com/Feats.aspx"],
      "domain":    "2e\\.aonprd\\.com",
      "delimiter": "Feats\\.aspx",
      "target":    "Feats\\.aspx\\?ID=\\d+",
      "maxPages":  500
    }
  }
}
```

| Regex | Role | Effect |
|-------|------|--------|
| `domain` | Scope filter | Links must match to be considered at all. Prevents the crawler from following links off-domain. |
| `delimiter` | Traversal filter | Links matching `domain` AND `delimiter` are followed (added to the frontier). Others are ignored. |
| `target` | Collection filter | Links matching `domain` AND `delimiter` AND `target` are collected as results. |

In the example above:
- Any link to a different domain is ignored.
- Links to `Feats.aspx` (without query string) are traversed: they're list pages.
- Links to `Feats.aspx?ID=\d+` are collected; they're detail pages.
- The starting URL itself is traversed first.

Note: Every link must match `domain` to be considered. If a link doesn't match `domain`, it's not evaluated against `delimiter` or `target` at all. This keeps crawls confined to their target site.

## Visited and collected sets

Two internal sets track state:
- `#visited`: URLs already traversed (prevents loops).
- `#collected`: URLs matched as results.

A URL can be traversed without being collected. The crawler follows list pages but only hands back detail pages.

## Concurrency model

Traversal is breadth-first, not depth-first. All URLs at a given frontier depth are fetched and parsed concurrently via `Promise.all`. The crawler collects all links from depth 0, then all links from depth 1, then depth 2, etc. This means you discover broad categories of results before drilling deep into any one.

`rateLimitMs` and `jitterMs` apply per request, same as scrapers. Even though multiple URLs are fetched in parallel, each still waits its turn in the rate limiter. If `rateLimitMs: 500` and concurrency is 10, you're still issuing requests 500ms apart; the concurrency is about how many are in flight (buffered in the rate limiter queue), not about how fast they're issued.

## Revisit semantics

The crawler tracks `#visited` (URLs already traversed) and `#collected` (URLs in results). Once a URL is added to `visited`, revisiting it from another depth is skipped; no duplicate fetches. This prevents infinite loops if your site has bidirectional links. A URL can be traversed without being collected (list pages are traversed but not returned). A URL is collected only if it matches all three regexes.

## maxPages

```json
"maxPages": 500
```

Hard ceiling on collected results. The crawl stops as soon as this many URLs have been matched as results, even if there are more frontier URLs to follow. The crawler doesn't keep searching after hitting the limit; the next traversal iteration will discover that `results.size >= maxPages` and halt.

## Deduplication and sorting

Results are deduplicated automatically; the same URL appearing at multiple traversal depths is collected once. The dedupe happens at collection time: if URL A matches `target` at depth 0 and again at depth 2, it's added to results on the first match; the second match sees it's already in `collected` and skips it.

Numeric collation rationale: By default, `Item-10` sorts before `Item-2` because string comparison is lexicographic (`"1" < "2"`). Numeric-aware collation sorts by the numeric value of each segment, so `Item-2` then `Item-10`. This makes URL lists sortable and diff-able across runs; you can `diff before.json after.json` and see only actual changes, not reordering artifacts.

Sorting uses a numeric-aware collator: `Item-10` sorts after `Item-9`, not between `Item-1` and `Item-2`. Consistent ordering makes the output list diff-able.

## Inline crawler vs top-level crawler

Two ways to configure a crawler:

**Top-level** (`crawlers` block); runs as a standalone job, produces a URL list:

```json
{
  "crawlers": {
    "aonprd-feats": {
      "startUrls": ["https://2e.aonprd.com/Feats.aspx"],
      "domain":    "2e\\.aonprd\\.com",
      "delimiter": "Feats\\.aspx",
      "target":    "Feats\\.aspx\\?ID=\\d+",
      "maxPages":  500
    }
  }
}
```

**Inline** (`targets[].crawler`); the scrape target crawls before it fetches:

```json
{
  "targets": {
    "aonprd": {
      "baseUrl":  "https://2e.aonprd.com",
      "pipeline": ["html:fetch", "aonprd:parse", "json:write"],
      "crawler": {
        "startUrls": ["https://2e.aonprd.com/Feats.aspx"],
        "domain":    "2e\\.aonprd\\.com",
        "delimiter": "Feats\\.aspx",
        "target":    "Feats\\.aspx\\?ID=\\d+",
        "maxPages":  500
      }
    }
  }
}
```

In the inline case, the orchestrator runs the crawler first, then scrapes each collected URL through the target pipeline.

## Related

- [Configuration](./configuration); crawler config schema
- [Scrapers](./scrapers); what happens after the crawler hands back URLs
- [Cache](./cache); crawler requests go through the rate limiter but not the cache
