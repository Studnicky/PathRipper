---
layout: doc
title: Crawler
---

# Crawler

A crawler starts at one or more seed URLs, follows links that match a pattern (the *frontier*), and collects the detail pages you actually want to scrape. `LinkLister` hands those collected URLs to the scrape pipeline once the run is done; Ripperoni batches the haul and fans out to parse each one.

The crawl runs as an embedded DAG inside the parent pipeline, powered by `@studnicky/dagonizer`. Because the traversal loops — fetching a page, extracting new links, enqueuing them, then fetching again — the DAG is cyclic by design.

## Wiring it up

A crawler lives inside its target, under `targets.<name>.crawler`. List `crawl:list-targets` first in the pipeline; it reads that block, walks out from your `startUrls`, and collects every detail-page URL before the fetch and parse steps run.

```json
{
  "output": { "basePath": "./output", "format": "json", "pretty": true },
  "targets": {
    "aonprd": {
      "baseUrl":          "https://2e.aonprd.com",
      "rateLimitMs":      1000,
      "jitterMs":         250,
      "maxRetries":       3,
      "retryBaseDelayMs": 500,
      "retryMaxDelayMs":  30000,
      "pipeline": ["crawl:list-targets", "html:fetch", "aonprd:parse", "json:write"],
      "crawler": {
        "startUrls": ["https://2e.aonprd.com/Feats.aspx"],
        "domain":    "2e\\.aonprd\\.com",
        "target":    "\\?ID=",
        "delimiter": "\\.aspx",
        "rateLimitMs": 1000,
        "jitterMs":    250,
        "maxPages":    5000
      }
    }
  }
}
```

## Fields

Fields are strings (regex patterns) or integers. Pass raw pattern strings — Ripperoni compiles them internally.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `startUrls` | `string[]` | Yes | Absolute URLs where the crawl begins. At least one required. |
| `domain` | `string` (regex) | Yes | Links must match this pattern to enter the crawl at all. Keeps traversal on-site. |
| `target` | `string` (regex) | Yes | Links matching `domain` AND `delimiter` AND `target` get collected as scrape targets. |
| `delimiter` | `string` (regex) | Yes | Links matching `domain` AND `delimiter` get added to the traversal frontier. |
| `rateLimitMs` | `integer` | No | Minimum delay between crawler requests. Independent of the parent target's rate limit. |
| `jitterMs` | `integer` | No | Maximum random additional delay added on top of `rateLimitMs`. |
| `maxPages` | `integer` | No | Hard ceiling on collected results. Omit for an unbounded crawl — runs until the frontier empties. |

The crawl terminates when the frontier empties, `maxPages` is reached, or all reachable links under `domain`/`delimiter` have been visited.

## Three-regex decision tree

Each link the crawler encounters passes three filters in order:

1. **Domain filter** — matches `domain`? Keep it. Otherwise, drop it entirely.
2. **Delimiter filter** — also matches `delimiter`? Add it to the traversal frontier (the queue of pages to visit next).
3. **Target filter** — also matches `target`? Collect it as a scrape URL.

In the aonprd example:

```
domain    →  2e\.aonprd\.com   (scope: stay on this domain)
delimiter →  \.aspx            (traverse: follow .aspx pages as list/category pages)
target    →  \?ID=             (collect: gather ?ID= URLs as scrape targets)
```

- Links containing `.aspx` get followed as index/list pages. These are the sausage-links — they lead to more links rather than to the content you want.
- Links containing `?ID=` get collected as individual detail pages.
- A link can be traversed without being collected — index pages are followed but not handed to the scraper.

## Traversal strategy

The crawler runs breadth-first search (BFS) as a native cyclic DAG in `@studnicky/dagonizer`:

```
crawl:init-frontier
  ready → crawl:fetch-and-extract
  empty → crawl:exhausted

crawl:fetch-and-extract
  success / empty / error / permanent → crawl:dedupe-and-enqueue

crawl:dedupe-and-enqueue
  frontier-ready   → crawl:fetch-and-extract   ← back-edge (loop)
  frontier-empty   → crawl:exhausted
  budget-exhausted → crawl:exhausted

crawl:exhausted → crawl:completed (terminal)
```

The back-edge from `crawl:dedupe-and-enqueue` to `crawl:fetch-and-extract` is a native cyclic edge. The engine re-executes on in-place state until `DedupeAndEnqueueNode` routes to `crawl:exhausted`. No trampoline, no DAG cloning.

All URLs at a given frontier depth are fetched and parsed before the next level begins. Each request passes through the rate limiter, so `rateLimitMs`/`jitterMs` apply per request.

## Visited and collected sets

Two internal sets prevent redundant work:

- **visited** — URLs already traversed. A URL seen at depth 0 is skipped if it appears again at depth 3.
- **discovered** — URLs collected as scrape targets. Deduplicated — a URL appearing at multiple depths is collected once.

Index pages are visited but not included in the result set.

## maxPages

```json
"maxPages": 5000
```

Hard ceiling on collected results. The crawl stops as soon as this many target URLs match, even if frontier URLs remain. Leave `maxPages` off and it runs long and hard until the frontier's picked clean.

## Deduplication and sorting

Results are deduplicated at collection time. The final list sorts with a numeric-aware collator so `Item-10` lands after `Item-9`, not between `Item-1` and `Item-2`. Consistent ordering makes the list diff-able across runs.

## Full example (aonprd)

Crawls all index pages on `2e.aonprd.com`, collects every `?ID=` detail URL, then scrapes them through the `aonprd:parse` pipeline:

```json
{
  "output": { "basePath": "./output", "format": "json", "pretty": true },
  "targets": {
    "aonprd": {
      "baseUrl":          "https://2e.aonprd.com",
      "rateLimitMs":      1000,
      "jitterMs":         250,
      "maxRetries":       3,
      "retryBaseDelayMs": 500,
      "retryMaxDelayMs":  30000,
      "headers": {
        "User-Agent": "ripperoni-e2e/2.0 (+https://github.com/Studnicky/ripper)"
      },
      "pipeline": ["crawl:list-targets", "html:fetch", "aonprd:parse", "json:write"],
      "crawler": {
        "startUrls": [
          "https://2e.aonprd.com/Actions.aspx",
          "https://2e.aonprd.com/Ancestries.aspx",
          "https://2e.aonprd.com/Classes.aspx",
          "https://2e.aonprd.com/Equipment.aspx",
          "https://2e.aonprd.com/Feats.aspx",
          "https://2e.aonprd.com/Monsters.aspx",
          "https://2e.aonprd.com/Spells.aspx"
        ],
        "domain":      "2e\\.aonprd\\.com",
        "target":      "\\?ID=",
        "delimiter":   "\\.aspx",
        "rateLimitMs": 1000,
        "jitterMs":    250,
        "maxPages":    5000
      }
    }
  }
}
```

## Related

- [Configuration](./configuration) — full config schema reference
- [Scrapers](./scrapers) — what happens after the crawler hands back URLs
- [Cache](./cache) — crawler requests use the rate limiter; configure `target.cache` for response caching
