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
| `rateLimitMs` | integer ≥ 0 |  | Minimum milliseconds between requests. |
| `jitterMs` | integer ≥ 0 |  | Random jitter added on top of `rateLimitMs`. Applied per request. |
| `maxRetries` | integer 0–10 |  | Retry attempts on transient errors. |
| `retryBaseDelayMs` | integer ≥ 100 |  | Base delay for retry backoff. |
| `retryMaxDelayMs` | integer ≥ 1000 |  | Backoff ceiling. |
| `concurrency` | integer 1–32 | `1` | Parallel fetch/process slots. |
| `maxPages` | integer ≥ 0 |  | Stop after processing this many pages. |
| `headers` | object |  | Additional HTTP headers. Include `User-Agent`. |
| `outputSchema` | string |  | Path to a JSON Schema file. Records that fail validation are handled per `onSchemaError`. |
| `onSchemaError` | `"halt"` \| `"skip"` \| `"warn"` |  | What to do when a record fails schema validation. |
| `includeRawContent` | boolean | `false` | When `true`, each output record gains a `_raw` field carrying the raw fetched content. See [Raw content output](#raw-content-output) below. |
| `mapping` | object |  | Field-rename map applied after plugin output. |
| `cache` | CacheConfig |  | See [Cache](./cache). |
| `crawler` | CrawlerConfig |  | Inline crawler config for this target. |

Concurrency bound rationale: Concurrency is clamped to 1–32 to prevent runaway parallelism. At concurrency 32, you can have 32 HTTP requests in flight simultaneously. This is usually enough to saturate downstream bandwidth and quickly hit many servers' rate limits. Beyond 32, the marginal benefit drops and the risk of getting blocked increases. If you need more parallelism, run multiple Ripperoni instances.

Validation timing: When validation errors surface depends on your schema. If your `outputSchema` has required fields and your plugin sets `output: {}`, the validation fails when `json:write` tries to serialize the record. The error is handled per `onSchemaError`: `"halt"` throws and stops the run, `"skip"` logs a warning and skips the file, `"warn"` logs and writes anyway.

Retry × concurrency worst-case: If every fetch in a batch of `concurrency` tasks encounters a transient error and retries to `maxDelayMs` (30 seconds), the batch duration could be 30+ seconds. Total run time is `ceil(N / concurrency) * maxRetryTime`. For 1000 URLs with concurrency 10: `ceil(1000/10) * 30s = 100 * 30 = 50 minutes` in the absolute worst case (every fetch fails and retries max times). In practice, cache hits and successful first attempts keep this much lower.

Field mapping worked example: After your plugin extracts a record, `mapping` renames fields without touching your code:

```json
"targets": {
  "aonprd": {
    "pipeline": ["html:fetch", "aonprd:parse", "json:write"],
    "mapping": {
      "name": "title",
      "description": "desc"
    }
  }
}
```

If your plugin sets `state.output = { name: "Fireball", description: "Conjures..." }`, the written file gets `{ title: "Fireball", desc: "Conjures...", ... }`. The original fields are gone; only the mapped names appear in the JSON.

Cache and retry interaction: The cache sits upstream of retry logic. A cache hit means no retry-executor is invoked (no exponential backoff). A cache miss triggers the full HTTP stack: rate limiter, retry executor with backoff, then cache write on success. The first fetch of a URL can take up to `maxRetryTime`; the second hit takes microseconds (cache read).

Validation errors surface at first write. If your plugin produces invalid output, the first file write detects it. All subsequent pages from the same target go through the same validator, so you'll see the full picture of validation failures quickly (don't run all 1000 pages to find out your schema is wrong).

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

## Raw content output

Setting `includeRawContent: true` on a target adds a `_raw` field to every output record just before it is written to disk. This field carries the raw fetched bytes alongside the parsed fields, so downstream consumers can re-parse historical Ripperoni output without depending on Ripperoni's cache infrastructure.

### Shape

```json
{
  "_raw": {
    "contentType": "text/html",
    "content":     "<html>...</html>",
    "fetchedAt":   "2026-05-07T04:00:00.000Z"
  }
}
```

| Field | Type | Notes |
|-------|------|-------|
| `contentType` | string | MIME type of the response (`text/html` for HTML targets). |
| `content` | string | Full raw response body, byte-for-byte. |
| `fetchedAt` | ISO-8601 string | Timestamp at which the content was fetched. |

### When to enable

Enable it when downstream consumers need to re-derive fields that were not extracted in the original scrape run. For example, Squashage v0.6.0 max-extraction mode reads `_raw.content` to re-parse HTML without fetching the live site again.

Disable it (the default) for production scrapes where storage is a concern. Rough estimate: 15,000 AONPRD records x 80 KB of HTML = roughly 1.2 GB of additional output. Enable it only for targeted runs or when archiving for later re-processing.

### Plugin contract

Plugins must not read or write the `_raw` field. It is set by `html:fetch` and consumed by `json:write` / `jsonl:append`. Plugins interact with `state.page.html` and `state.output` as usual; `_raw` is injected transparently into the serialized file just before the disk write.

### Example config

```json
{
  "targets": {
    "aonprd": {
      "baseUrl":           "https://2e.aonprd.com",
      "pipeline":          ["html:fetch", "aonprd:parse", "json:write"],
      "includeRawContent": true,
      "cache": { "dir": "./output/.cache/aonprd", "mode": "read-write" }
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

- [Pipeline](./pipeline); task registration and state shape
- [Scrapers](./scrapers); HtmlScraper vs MediaWikiScraper
- [MediaWiki](./mediawiki); three enumeration modes
- [Crawler](./crawler); LinkLister behavior
- [Cache](./cache); read/write modes, TTL, eviction
