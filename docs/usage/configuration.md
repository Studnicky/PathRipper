---
layout: doc
title: Configuration
---

# Configuration

A `state.json` file (`RunStateSchema`) drives a run alongside the orchestration DAG. The state file supplies all runtime parameters — what to fetch, how fast, where to write, how to crawl. It is validated at startup before any network activity begins.

Pass it on the command line:

```bash
ripperoni run mysite.dag.jsonld --state mysite.state.json
```

Schema source of truth: `src/schemas/RunStateSchema.ts`.

## Top-level fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `baseUrl` | URI | no | Base URL for the target. All fetched URLs resolve against this. Required when using `html:fetch`. |
| `apiUrl` | URI | no | MediaWiki API endpoint (e.g. `https://en.wikipedia.org/w/api.php`). Required when using `wiki:fetch`. |
| `rateLimitMs` | integer ≥ 0 | no | Minimum milliseconds between requests. |
| `jitterMs` | integer ≥ 0 | no | Random jitter added on top of `rateLimitMs` per request. |
| `maxRetries` | integer 0–10 | no | Retry attempts on transient errors. |
| `retryBaseDelayMs` | integer ≥ 100 | no | Base delay for retry backoff. |
| `retryMaxDelayMs` | integer ≥ 1000 | no | Backoff ceiling. |
| `headers` | object | no | Additional HTTP request headers. Include `User-Agent`. |
| `output` | OutputConfig | yes | Output settings (see below). |
| `cache` | CacheConfig | no | Cache settings. Defaults to `read-write` at `output/.cache/<taskName>`. |
| `crawler` | CrawlerConfig | no | Link-crawler config for the `crawl:discover` DAG. |
| `urls` | string[] | no | Explicit URL or title list. When present and no `crawl:discover` node is needed, the scatter reads directly from this. |
| `useJsdom` | boolean | no | Pass fetched HTML through JSDOM before parsing. Enables synchronous script execution. |
| `jsdomLoadTimeoutMs` | integer ≥ 1000 | no | Ceiling for the JSDOM `load` event wait. Defaults to `max(10000, retryMaxDelayMs ?? 30000)`. |
| `parallelWorkers` | boolean | no | Route scatter items to a `WorkerThreadContainer` pool. Requires `npm run build:workers`. |
| `includeRawContent` | boolean | no | Include `_raw` field in output records. Default `true`. |
| `outputSchema` | string | no | Path to a JSON Schema file for output record validation. |
| `onSchemaError` | `"halt"` \| `"skip"` \| `"warn"` | no | Disposition when a record fails schema validation. |

### `output`

| Key | Type | Required | Notes |
|-----|------|----------|-------|
| `basePath` | string | yes | Base directory for all written output files. |
| `format` | `"json"` \| `"jsonl"` | no | Output file format. Default `"json"`. |
| `pretty` | boolean | no | Pretty-print JSON output. Default `false`. |
| `splitByTaskName` | boolean | no | When `true`, output is partitioned into per-task subdirectories beneath `basePath`. |

### `cache`

| Key | Type | Required | Notes |
|-----|------|----------|-------|
| `dir` | string | yes | Directory for cache files. |
| `mode` | enum | yes | `read-write`, `read-only`, `write-only`, or `off`. `off` requires `includeRawContent: false`. |
| `ttlMs` | integer ≥ 0 | no | Entries older than this are treated as misses. |

### `crawler`

Configures the `crawl:discover` embedded DAG. All regex fields are strings compiled internally.

| Key | Type | Required | Notes |
|-----|------|----------|-------|
| `startUrls` | string[] | yes | Absolute URLs where the crawl begins. At least one required. |
| `domain` | regex string | yes | Links must match to enter the crawl at all. Bounds traversal to one site. |
| `target` | regex string | yes | Links matching `domain` + `delimiter` + `target` are collected as scrape targets. |
| `delimiter` | regex string | yes | Links matching `domain` + `delimiter` are added to the traversal frontier. |
| `rateLimitMs` | integer ≥ 0 | no | Gap between crawler requests, independent of the target rate limit. |
| `jitterMs` | integer ≥ 0 | no | Random jitter added on top of crawler `rateLimitMs`. |
| `maxPages` | integer ≥ 1 | no | Hard ceiling on collected target URLs. Omit for an unbounded crawl. |
| `concurrency` | integer 1–32 | no | Frontier URLs fetched concurrently per BFS depth level. Defaults to `1`. |

### `reservoir`

Controls reservoir scatter on the orchestration's `ScatterNode` for very large URL lists. When enabled, the engine processes `capacity` items concurrently instead of loading the full list into memory at once.

| Key | Type | Required | Notes |
|-----|------|----------|-------|
| `keyField` | string | yes | State field name used as the reservoir slot key. Must match `itemKey` on the scatter node (typically `currentItem`). |
| `capacity` | integer 1–1000 | yes | Maximum concurrent scatter slots. The engine pulls items in batches of this size, releasing a slot only on item completion. |
| `idleMs` | integer ≥ 1000 | no | Milliseconds after which an idle, source-exhausted reservoir is considered complete. Default `30000`. |

Activate reservoir scatter by adding the matching `reservoir` block to the `ScatterNode` in the `.dag.jsonld` file — the `state.json` entry documents intent and is reflected in the example DAG.

## Full example

```json
{
  "baseUrl":          "https://2e.aonprd.com",
  "rateLimitMs":      1000,
  "jitterMs":         250,
  "maxRetries":       3,
  "retryBaseDelayMs": 500,
  "retryMaxDelayMs":  30000,
  "headers": {
    "User-Agent": "ripperoni/3.0 (+https://github.com/Studnicky/ripper)"
  },
  "output": {
    "basePath": "./output",
    "format":   "json",
    "pretty":   true
  },
  "cache": {
    "dir":   "./output/.cache/aonprd",
    "mode":  "read-write",
    "ttlMs": 86400000
  },
  "crawler": {
    "startUrls": [
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

## Output folder layout

Records land under `output.basePath` in a subdirectory named after the plugin's task. With `basePath: ./output` and a plugin task named `aonprd`, records land in `./output/aonprd/`. When `splitByTaskName: true`, output is further partitioned into per-task subdirectories.

```
output/
  aonprd/
    Feats.aspx?ID=750.json
    Spells.aspx?ID=1.json
  .cache/
    aonprd/
      a3/
        b7c9d2e1f4.meta.json
      bodies/
        a3/
          b7c9d2e1f4.body
```

Failed pages are written to `failures.json` in the output directory.

## Raw content

When `includeRawContent` is `true` (the default), each output record carries a `_raw` field:

```json
{
  "_raw": {
    "contentType": "text/html",
    "content":     "<html>...</html>",
    "fetchedAt":   "2026-05-07T04:00:00.000Z"
  }
}
```

Set `includeRawContent: false` to strip `_raw` from output. Setting `cache.mode: "off"` while `includeRawContent` is `true` is rejected at startup — raw content output without a write-capable cache exhausts disk on large scrapes. To disable caching, set `includeRawContent: false` first, then `cache.mode: "off"`.

## Related

- [Authoring a DAG](/usage/pipeline): placement types, `DAGBuilder` API, built-in nodes
- [Plugins](/usage/plugins): node contract and the services bag
- [Crawler](/usage/crawler): `crawl:discover` DAG and regex decision tree
- [Cache](/usage/cache): read/write modes, TTL, eviction
