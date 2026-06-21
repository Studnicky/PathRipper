---
layout: doc
title: Cache
---

# Cache

The cache is the meat locker — fetch a page once and it stays in cold storage. Every subsequent run skips the network entirely and reads the stored body directly, handing it straight to the parse task.

Iterating on a parse plugin is fast with the HTTP stack out of the way: change the plugin, rerun, and extraction completes in seconds.

Sharding keeps the cache fast at scale. Without it, a directory with 10,000 entries becomes a single flat directory where `readdir()` gets slow (hundreds of milliseconds on some filesystems). Sharding by the first two hex characters of the cache key caps each subdirectory at ~256 entries — fast to traverse, and spread wide enough that collisions are rare.

## Default-on

Cache is on by default. Every `targets` and `mediawiki` entry that omits a `cache` block receives:

```json
{ "dir": "output/.cache/<targetId>", "mode": "read-write" }
```

where `<targetId>` is the key of the entry in the config (e.g. `"aonprd"` → `output/.cache/aonprd`). No explicit cache config is required for the default behavior.

### Raw + cache-off invariant

Setting `cache.mode: "off"` while `includeRawContent` is `true` (the default) is rejected at config load with `RipperConfigError`. Raw content output without a write-capable cache exhausts disk on large scrapes — the loader catches this misconfiguration before a single byte is fetched.

To disable caching, set `includeRawContent: false` first (opt out of raw output), then set `cache.mode: "off"`:

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

## How it works

The cache stores two things per entry:
- A `.meta.json` file with request metadata and a `bodyPath` pointer.
- A body file at `bodyPath` with the raw response body.

Meta files live at `<dir>/<key[0:2]>/<key[2:]>.meta.json`. Body files live under a separate `bodies/` subdirectory: `<dir>/bodies/<key[0:2]>/<key[2:]>.body` (the body root can be overridden via the programmatic `bodyDir` option). Sharding by the first two characters of the cache key keeps each subdirectory small enough that `readdir()` stays fast even with tens of thousands of entries.

The key is derived from the request: HTTP method + URL + sorted request headers, hashed to a 40-character SHA-1 hex string. In practice Ripperoni only issues GET requests with no per-request header overrides, so the key is effectively the URL hash.

## Modes

`mode` controls whether Ripperoni reads from the cache, writes to it, both, or neither.

```json
"cache": {
  "dir":  "./output/.cache/aonprd",
  "mode": "read-write"
}
```

| Mode | Reads | Writes | When to use |
|------|-------|--------|-------------|
| `read-write` | yes | yes | Normal development; skip the network on subsequent runs. |
| `read-only` | yes | no | Replay from cache only. Fails if a URL is not cached. Useful for offline reproduction. |
| `write-only` | no | yes | Always fetch; always cache. Refreshes stale entries. |
| `off` | no | no | No caching. Every run hits the network. Only valid when `includeRawContent: false`. |

Cache hit and rate limiting: On a cache hit, the cached body returns directly without entering the rate limiter. Rate limiting protects the remote server, not your disk — reading from disk is free and fast. Cache hits still enter the pipeline; the parse task runs, extraction happens, and files are written.

Concurrent write semantics: When two tasks cache the same URL simultaneously, the last write wins (the second task's body overwrites the first). Cache writes carry no lock or transaction. Within a single run this is a non-issue because the dispatcher routes each URL to one concurrency slot. Give each concurrent Ripperoni instance its own cache directory; sharing a cache directory across instances causes interference.

## TTL

```json
"cache": {
  "dir":   "./output/.cache/aonprd",
  "mode":  "read-write",
  "ttlMs": 86400000
}
```

`ttlMs` sets the time-to-live (how long a cached entry stays valid). An entry older than `ttlMs` is treated as a miss; the fetcher goes to the network and overwrites the entry. Omit `ttlMs` for no expiration.

`86400000` = 24 hours. `604800000` = 7 days.

Stale-entry behavior: On read, the entry's `fetchedAt` timestamp is checked against the current time. When `now - fetchedAt > ttlMs`, the entry is a cache miss. The fetcher re-fetches the URL and writes a fresh entry with an updated `fetchedAt`. This is write-through expiration: entries refresh on access, not on a background schedule.

## LRU eviction

When `maxEntries` is set (programmatic use only; not in the JSON config schema), the cache evicts the oldest entries by `fetchedAt` on write. The JSON config only exposes `dir`, `mode`, and `ttlMs`.

## Cache key

The key derives from `{ method, url, headers }`; headers are sorted alphabetically before hashing so that equivalent header sets in different declaration orders produce the same key. The same method + URL + headers always maps to the same key. Ripperoni only GETs with no per-request header overrides, so in practice the key is the URL hash.

```ts
const key = ScraperCache.keyFor({ method: 'GET', url });
```

## Workflow

First run (nothing cached yet):

```
html:fetch → cache miss → HTTP GET → store in cache → hand HTML to parse task
```

Subsequent runs (entry in cache):

```
html:fetch → cache hit → return cached HTML → hand HTML to parse task
```

A cache hit touches the network zero times. Change the parse plugin, rerun, done.

## Cache directory layout

```
output/.cache/aonprd/
  a3/
    b7c9d2e1f4.meta.json
  7f/
    1e8a3c5b29.meta.json
  bodies/
    a3/
      b7c9d2e1f4.body
    7f/
      1e8a3c5b29.body
```

Meta index files live directly under `<dir>/<shard>/`. Body files live under `<dir>/bodies/<shard>/` by default (the body root can be overridden via the programmatic `bodyDir` option). The shard prefix keeps each subdirectory small enough that `readdir()` stays fast even with tens of thousands of entries.

## Read-only mode failure modes

In `mode: "read-only"`, the cache writes nothing. A fetch request for a URL absent from the cache throws immediately — the fetcher has no network fallback. This catches config typos early: a new URL surfaces an error on the spot rather than silently hitting the network.

## Clearing the cache

Delete the cache directory:

```bash
rm -rf ./output/.cache/aonprd
```

Or switch `mode` to `write-only` for one run to refresh from the network. Every URL fetches fresh and overwrites its cached entry. This is faster than deleting the directory when you want a full refresh and prefer to keep the directory structure intact.

## Related

- [Scrapers](./scrapers); how HtmlScraper uses the cache
- [Configuration](./configuration); cache config schema
