---
layout: doc
title: Configuration
---

# Configuration

The config is a JSON file. Load it with `ripperoni --config ripperoni.config.json`. Schema source of truth: `src/schemas/internal/RipperConfigSchema.ts`.

Copy `ripperoni.config.example.json` as a starting point. The unprefixed file is gitignored.

## Top-level shape

```ts
{
  output:    OutputConfig;                      // required
  targets?:  { [name: string]: TargetConfig };  // HTML scrape targets
  mediawiki?: { [name: string]: WikiConfig };   // MediaWiki scrape targets
  crawlers?: { [name: string]: CrawlerConfig }; // link-crawler configs
}
```

### `output`

Global output settings:

| Key | Type | Required | Notes |
|-----|------|----------|-------|
| `basePath` | string | yes | Base directory for all written output files. |
| `format` | `"json"` \| `"html"` \| `"text"` | no | Output file format. `json` is the default and what downstream tools (like Squashage) expect. |
| `pretty` | boolean | no | Pretty-print JSON output. Default `false`. |

---

## targets (HTML scrape)

Each key is a target name (e.g. `"aonprd"`). Value is a target config.

### Required

| Key | Type | Notes |
|-----|------|-------|
| `baseUrl` | URI | Base URL for the target. All fetched URLs are resolved against this. |
| `pipeline` | string[] | Ordered task names. Minimum one. |

### Optional

| Key | Type | Default | Notes |
|-----|------|---------|-------|
| `rateLimitMs` | integer ≥ 0 | — | Minimum milliseconds between requests. |
| `jitterMs` | integer ≥ 0 | — | Random jitter added on top of `rateLimitMs`. Applied per request. |
| `maxRetries` | integer 0–10 | — | Retry attempts on transient errors. |
| `retryBaseDelayMs` | integer ≥ 100 | — | Base delay for retry backoff. |
| `retryMaxDelayMs` | integer ≥ 1000 | — | Backoff ceiling. |
| `concurrency` | integer 1–32 | `1` | Parallel fetch/process slots. |
| `maxPages` | integer ≥ 0 | — | Stop after processing this many pages. |
| `headers` | object | — | Additional HTTP headers. Include `User-Agent`. |
| `outputSchema` | string | — | Path to a JSON Schema file. Records that fail validation are handled per `onSchemaError`. |
| `onSchemaError` | `"halt"` \| `"skip"` \| `"warn"` | — | What to do when a record fails schema validation. |
| `mapping` | object | — | Field-rename map applied after plugin output. |
| `cache` | CacheConfig | — | See [Cache](./cache). |
| `crawler` | CrawlerConfig | — | Inline crawler config for this target. |

### Example

```json
{
  "targets": {
    "aonprd": {
      "baseUrl":          "https://2e.aonprd.com",
      "rateLimitMs":      1000,
      "jitterMs":         250,
      "maxRetries":       3,
      "retryBaseDelayMs": 500,
      "retryMaxDelayMs":  30000,
      "headers": {
        "User-Agent": "ripperoni/2.0 (+https://github.com/Studnicky/PathRipper)"
      },
      "pipeline": ["html:fetch", "aonprd:parse", "json:write"],
      "cache": {
        "dir": "./output/.cache/aonprd",
        "mode": "read-write"
      }
    }
  }
}
```

---

## mediawiki

Same rate-limit, retry, concurrency, and cache options as `targets`. MediaWiki-specific additions:

| Key | Type | Required | Notes |
|-----|------|----------|-------|
| `apiUrl` | URI | yes | MediaWiki API endpoint (e.g. `https://en.wikipedia.org/w/api.php`). |
| `batchSize` | integer 1–50 | no | Pages per batch request. MediaWiki API maximum is 50. |
| `categories` | string[] | no | Category names to enumerate. When present, overrides full-site enumeration. |

See [MediaWiki](./mediawiki) for the three enumeration modes.

---

## crawlers

Top-level crawlers define link-harvesting jobs independent of scrape targets.

| Key | Type | Required | Notes |
|-----|------|----------|-------|
| `startUrls` | URI[] | yes | Entry points for the crawl. |
| `domain` | regex string | yes | Links must match to be considered. Bounds the crawl to one site. |
| `target` | regex string | yes | Links matching `delimiter` AND this are collected as results. |
| `delimiter` | regex string | yes | Links matching this are traversed (followed). Others are ignored. |
| `rateLimitMs` | integer ≥ 0 | no | Gap between requests. |
| `jitterMs` | integer ≥ 0 | no | Jitter on top of rate limit. |
| `maxPages` | integer ≥ 1 | no | Traversal ceiling. |

See [Crawler](./crawler) for how the three regexes interact.

---

## cache config (shared shape)

Both `targets` and `mediawiki` blocks accept the same cache shape:

```json
"cache": {
  "dir":   "./output/.cache/aonprd",
  "mode":  "read-write",
  "ttlMs": 86400000
}
```

| Key | Type | Required | Notes |
|-----|------|----------|-------|
| `dir` | string | yes | Directory for cache meta files. |
| `mode` | enum | yes | `read-write`, `read-only`, `write-only`, or `off`. |
| `ttlMs` | integer ≥ 0 | no | Entries older than this (in ms) are treated as misses. |

See [Cache](./cache) for sharding, eviction, and TTL behavior.

---

## Related

- [Pipeline](./pipeline) — task registration and state shape
- [Scrapers](./scrapers) — HtmlScraper vs MediaWikiScraper
- [MediaWiki](./mediawiki) — three enumeration modes
- [Crawler](./crawler) — LinkLister behavior
- [Cache](./cache) — read/write modes, TTL, eviction
