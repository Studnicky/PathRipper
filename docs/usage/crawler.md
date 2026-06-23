---
layout: doc
title: Crawler
---

# Crawler

A crawler starts at one or more seed URLs, follows links that match a pattern (the *frontier*), and collects the detail pages you actually want to scrape. The built-in `crawl:discover` DAG hands those collected URLs to the scatter node via a `stateMapping`; Ripperoni fans out to parse each one.

The crawl runs as an embedded DAG inside the orchestration document, powered by `@studnicky/dagonizer`. Because the traversal loops — fetching a page, extracting new links, enqueuing them, then fetching again — the DAG is cyclic by design.

## Wiring it up

Embed `crawl:discover` in your orchestration DAG as an `EmbeddedDAGNode`. Its `stateMapping` seeds `state.urls` from `crawl.discovered` after the crawl completes; the scatter node reads `state.urls` and fans out.

```json
{
  "@type": "EmbeddedDAGNode",
  "name":  "discover",
  "dag":   "crawl:discover",
  "stateMapping": {
    "output": { "urls": "crawl.discovered" }
  },
  "outputs": { "success": "scrape", "error": "crawl-failed" }
}
```

Configure the crawl via the `crawler` block in `state.json`:

```json
{
  "baseUrl":     "https://2e.aonprd.com",
  "rateLimitMs": 1000,
  "jitterMs":    250,
  "output":      { "basePath": "./output", "format": "json", "pretty": true },
  "cache":       { "dir": "./output/.cache/aonprd", "mode": "read-write" },
  "crawler": {
    "startUrls":  ["https://2e.aonprd.com/Feats.aspx"],
    "domain":     "2e\\.aonprd\\.com",
    "target":     "\\?ID=",
    "delimiter":  "\\.aspx",
    "rateLimitMs": 1000,
    "jitterMs":    250,
    "maxPages":    5000
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
| `rateLimitMs` | `integer` | No | Minimum delay between crawler requests. Independent of the parent `rateLimitMs`. |
| `jitterMs` | `integer` | No | Maximum random additional delay added on top of `rateLimitMs`. |
| `maxPages` | `integer` | No | Hard ceiling on collected results. Omit for an unbounded crawl — runs until the frontier empties. |
| `concurrency` | `integer` 1–32 | No | Maximum number of frontier URLs fetched concurrently within a single BFS depth level. The rate limiter still applies between individual requests. Defaults to `1` (sequential). |

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

- Links containing `.aspx` get followed as index/list pages.
- Links containing `?ID=` get collected as individual detail pages.
- A link can be traversed without being collected — index pages are followed but not handed to the scraper.

## Traversal strategy

The `crawl:discover` DAG runs breadth-first search (BFS) as a native cyclic DAG:

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

The back-edge from `crawl:dedupe-and-enqueue` to `crawl:fetch-and-extract` is a native cyclic edge. The engine re-executes on in-place state until `crawl:dedupe-and-enqueue` routes to `crawl:exhausted`. No trampoline, no DAG cloning.

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

Hard ceiling on collected results. The crawl stops as soon as this many target URLs match, even if frontier URLs remain. Leave `maxPages` off and it runs long and hard until the frontier is picked clean.

## Deduplication and sorting

Results are deduplicated at collection time. The final list sorts with a numeric-aware collator so `Item-10` lands after `Item-9`, not between `Item-1` and `Item-2`. Consistent ordering makes the list diff-able across runs.

After the `crawl:discover` DAG completes, its `stateMapping` writes the collected URLs into `state.urls` via `crawl.discovered`. The scatter node in the orchestration reads `state.urls` and fans out.

## Full example (aonprd)

Orchestration (`tests/e2e/fixtures/aonprd-crawl.dag.jsonld` — key nodes):

```json
{
  "@type": "DAG",
  "name":  "aonprd:crawl",
  "entrypoint": "discover",
  "nodes": [
    {
      "@type": "EmbeddedDAGNode",
      "name":  "discover",
      "dag":   "crawl:discover",
      "stateMapping": { "output": { "urls": "crawl.discovered" } },
      "outputs": { "success": "scrape", "error": "crawl-failed" }
    },
    {
      "@type":     "ScatterNode",
      "name":      "scrape",
      "source":    "urls",
      "body":      { "dag": "aonprd:page" },
      "container": "worker",
      "itemKey":   "currentUrl",
      "gather": { "strategy": "partition", "partitions": { "success": "succeeded", "error": "failed" } },
      "outputs": { "all-success": "done", "partial": "done", "all-error": "done", "empty": "done" }
    }
  ]
}
```

State (`tests/e2e/fixtures/aonprd-crawler.state.json` — crawler block):

```json
{
  "baseUrl": "https://2e.aonprd.com",
  "crawler": {
    "startUrls": [
      "https://2e.aonprd.com/Actions.aspx",
      "https://2e.aonprd.com/Feats.aspx",
      "https://2e.aonprd.com/Spells.aspx",
      "https://2e.aonprd.com/Monsters.aspx"
    ],
    "domain":      "2e\\.aonprd\\.com",
    "target":      "\\?ID=",
    "delimiter":   "\\.aspx",
    "rateLimitMs": 1000,
    "jitterMs":    250,
    "maxPages":    5000
  }
}
```

## Related

- [Configuration](/usage/configuration): full `state.json` field reference
- [Scrapers](/usage/scrapers): what happens after the crawler hands back URLs
- [Cache](/usage/cache): crawler requests use the rate limiter; configure `cache` in state.json for response caching
