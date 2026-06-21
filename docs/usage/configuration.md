---
layout: doc
title: Configuration
---

# Configuration

This JSON file tells Ripperoni what to scrape, how to scrape it, and where to write the results. At run time each target's task list compiles into a per-page DAG executed by the [dagonizer](https://github.com/Studnicky/Dagonizer) engine. One JSON file tells the butcher what to grind, how fast, and where to hang the cuts. Load it with `ripperoni --config ripperoni.config.json`. Schema source of truth: `src/schemas/internal/RipperConfigSchema.ts`.

Copy `ripperoni.config.example.json` as a starting point. The unprefixed file is gitignored.

## Top-level shape

```ts
{
  output:     OutputConfig;                      // required
  targets?:   { [name: string]: TargetConfig };  // HTML scrape targets
  mediawiki?: { [name: string]: WikiConfig };    // MediaWiki scrape targets
}
```

### `output`

Global output settings:

| Key | Type | Required | Notes |
|-----|------|----------|-------|
| `basePath` | string | yes | Base directory for all written output files. |
| `format` | `"json"` \| `"html"` \| `"text"` | no | Output file format. `json` is the default and what downstream tools (like Squashage) expect. |
| `pretty` | boolean | no | Pretty-print JSON output. Default `false`. |
| `rawSubdir` | string | no | Subdirectory name under `basePath` where unprocessed HTTP response bodies are stored when `includeRawContent` is enabled on a target. |
| `rawExt` | string | no | File extension (without dot) used when persisting raw response bodies to disk. |
| `splitByTaskName` | boolean | no | When `true`, output files are partitioned into per-task subdirectories beneath `basePath`. |

---

## targets (HTML scrape)

Each key is a target name (e.g. `"aonprd"`). Value is a target config — the cut spec that tells the grinder what to fetch and how to dress it.

### Required

| Key | Type | Notes |
|-----|------|-------|
| `baseUrl` | URI | Base URL for the target. All fetched URLs are resolved against this. |
| `pipeline` | string[] | Ordered task names. Minimum one. At run time this list compiles into a per-page DAG (DAGBuilder). |

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
| `includeRawContent` | boolean | `true` | When `false`, raw content is omitted from `state.page._raw` during the pipeline run and no raw file is written to `raw/`. See [Output folder layout](#output-folder-layout) below. |
| `mapping` | object |  | Field-rename map applied after plugin output. |
| `cache` | CacheConfig | see [Cache defaults](#cache-config-shared-shape) | See [Cache](./cache). Omit to use the default. |
| `crawler` | CrawlerConfig |  | Inline crawler config for this target. |

Concurrency bound: Concurrency is clamped to 1–32. At concurrency 32, you have 32 HTTP requests in flight simultaneously — enough to saturate downstream bandwidth and hit many servers' rate limits fast. Beyond 32, marginal benefit drops and the risk of getting blocked rises. For more parallelism, run multiple Ripperoni instances.

Validation timing: When validation errors surface depends on your schema. If your `outputSchema` has required fields and your plugin sets `output: {}`, the validation fails when `json:write` tries to serialize the record. The error is handled per `onSchemaError`: `"halt"` throws and stops the run, `"skip"` logs a warning and skips the file, `"warn"` logs and writes anyway.

Retry × concurrency worst-case: If every fetch in a batch of `concurrency` tasks hits a transient error and retries to `maxDelayMs` (30 seconds), the batch duration can hit 30+ seconds. Total run time is `ceil(N / concurrency) * maxRetryTime`. For 1000 URLs with concurrency 10: `ceil(1000/10) * 30s = 100 * 30 = 50 minutes` in the absolute worst case (every fetch fails and retries max times). Cache hits and successful first attempts keep this much lower in practice.

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

Cache and retry interaction: The cache sits upstream of retry logic. A cache hit bypasses retry entirely — no backoff, no delay. A cache miss goes through the full HTTP stack: rate limiter, `HttpRetryPolicy` with decorrelated-jitter backoff, then a cache write on success. The first fetch of a URL can pay the full retry cost; subsequent hits take microseconds.

Validation errors surface at first write. If your plugin produces invalid output, the first file write detects it. All subsequent pages from the same target go through the same validator, so you see the full picture of validation failures quickly.

### Example

Cache is on by default — omit the `cache` block and Ripperoni uses `output/.cache/<targetId>` with `read-write` mode:

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
        "User-Agent": "ripperoni/3.0 (+https://github.com/Studnicky/ripper)"
      },
      "pipeline": ["html:fetch", "aonprd:parse", "json:write"]
    }
  }
}
```

This produces a cache at `output/.cache/aonprd` in `read-write` mode — identical to writing `"cache": { "dir": "output/.cache/aonprd", "mode": "read-write" }` explicitly.

---

## Raw content output

Every output record carries a `_raw` field by default. `html:fetch` injects it just before the record hits disk — raw fetched bytes alongside the parsed fields. Downstream consumers can re-parse historical Ripperoni output without touching Ripperoni's cache infrastructure.

### Default behaviour

Raw content is always written. Parsing and enrichment are additive layers on top — plugins set `state.output` fields that appear alongside `_raw`.

A pipeline with no plugin step (`["html:fetch", "json:write"]`) is valid and complete: it produces a raw dump per page. Use this for archiving, debugging, or deferring parsing to a downstream tool.

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

### Opting out (storage savings)

Set `includeRawContent: false` to strip `_raw` from output. Rough estimate: 15,000 AONPRD records × 80 KB of HTML = roughly 1.2 GB of additional output. When offline re-parsing is not a requirement, opt out and keep file sizes small.

When opting out of raw content, you may also set `cache.mode: "off"`:

```json
{
  "targets": {
    "aonprd": {
      "baseUrl":           "https://2e.aonprd.com",
      "pipeline":          ["html:fetch", "aonprd:parse", "json:write"],
      "includeRawContent": false,
      "cache":             { "dir": ".cache", "mode": "off" }
    }
  }
}
```

Setting `cache.mode: "off"` while `includeRawContent` is `true` (the default) is rejected at config load. See [Cache — Raw + cache-off invariant](./cache#raw--cache-off-invariant).

### Raw-dump-only pipeline (no plugin)

A pipeline without a plugin task produces one JSON file per page:

```json
{
  "targets": {
    "archive": {
      "baseUrl":  "https://example.com",
      "pipeline": ["html:fetch", "json:write"]
    }
  }
}
```

Output shape per record (`_raw` carries the content; `output` is empty because no plugin ran):

```json
{
  "_raw": {
    "contentType": "text/html",
    "content":     "<html>...</html>",
    "fetchedAt":   "2026-05-07T04:00:00.000Z"
  }
}
```

### Plugin contract

Plugins interact with `state.page.html` and `state.output`. The `_raw` field is set by `html:fetch` and consumed by `json:write` / `jsonl:append` — plugins leave it alone. Ripperoni injects it transparently into the serialized file just before the disk write.

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

## Embedded crawler (`targets.<name>.crawler`)

A crawler lives inside its target, under `targets.<name>.crawler`. When a `crawler` block is present, Ripperoni discovers pages to scrape by crawling from `startUrls` before invoking the pipeline. To activate crawling, include `crawl:list-targets` as the first task in `pipeline`.

### Required

| Key | Type | Notes |
|-----|------|-------|
| `startUrls` | URI[] | Entry points for the crawl. At least one URL required. |
| `domain` | regex string | Links must match to be followed. Bounds the crawl to one site. |
| `target` | regex string | Links matching this are collected as pages to scrape. |
| `delimiter` | regex string | Links matching this are traversed (followed) during discovery. |

### Optional

| Key | Type | Notes |
|-----|------|-------|
| `rateLimitMs` | integer ≥ 0 | Gap between crawler requests, independent of the target rate limit. |
| `jitterMs` | integer ≥ 0 | Random jitter added on top of `rateLimitMs`. |
| `maxPages` | integer ≥ 1 | Traversal ceiling — crawler stops after enqueuing this many pages. |

### Example

```json
{
  "targets": {
    "aonprd": {
      "baseUrl": "https://2e.aonprd.com",
      "pipeline": ["crawl:list-targets", "html:fetch", "aonprd:parse", "json:write"],
      "crawler": {
        "startUrls":  ["https://2e.aonprd.com/Spells.aspx"],
        "domain":     "2e\\.aonprd\\.com",
        "target":     "Spells\\.aspx\\?ID=",
        "delimiter":  "Spells\\.aspx",
        "rateLimitMs": 500,
        "jitterMs":    100,
        "maxPages":    2000
      }
    }
  }
}
```

See [Crawler](./crawler) for how the three regexes interact.

---

## cache config (shared shape)

Cache is on by default. Omitting the `cache` block from a `targets` or `mediawiki` entry applies:

```json
{ "dir": "output/.cache/<targetId>", "mode": "read-write" }
```

To override, supply an explicit `cache` block:

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
| `mode` | enum | yes | `read-write`, `read-only`, `write-only`, or `off`. `off` requires `includeRawContent: false`. |
| `ttlMs` | integer ≥ 0 | no | Entries older than this (in ms) are treated as misses. |

See [Cache](./cache) for sharding, eviction, TTL, and the raw + cache-off invariant.

---

## Related

- [Pipeline](./pipeline); task registration and state shape
- [Scrapers](./scrapers); HtmlScraper vs MediaWikiScraper
- [MediaWiki](./mediawiki); three enumeration modes
- [Crawler](./crawler); LinkLister behavior
- [Cache](./cache); read/write modes, TTL, eviction
