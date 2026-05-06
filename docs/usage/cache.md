---
layout: doc
title: Cache
---

# Cache

`ScraperCache` is a sharded, content-addressed pointer cache. It stores what was fetched so subsequent runs skip the network.

Problem being solved: Iterating on a parse plugin is slow if every run re-fetches all pages. The cache saves every HTTP response to disk so the next run can replay from cache without hitting the network. This makes the edit-test cycle fast: change your parse plugin, rerun, hit cache, extract in seconds instead of minutes.

Sharding rationale: Without sharding, a cache directory with 10,000 entries becomes a single flat directory where `readdir()` gets slow (hundreds of milliseconds per operation on some filesystems). By sharding into subdirectories using the first two hex characters of the cache key, each subdirectory holds ~256 entries. A `readdir()` of 256 files is fast; a `readdir()` of 10,000 is not. The two-character prefix is a sweet spot: enough entropy to spread load but not so granular that you end up with thousands of single-file directories.

## How it works

The cache stores two things per entry:
- A `.meta.json` file with request metadata and a `bodyPath` pointer.
- A body file at `bodyPath` with the raw response body.

Meta files live at `<dir>/<key[0:2]>/<key[2:]>.meta.json`. Sharding by the first two characters of the cache key prevents large directories from slowing filesystem traversal.

The key is derived from the request: HTTP method + URL, hashed to a fixed-length string.

## Modes

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
| `off` | no | no | No caching. Every run hits the network. |

Cache hit and rate limiting: On a cache hit, the cached body is returned directly without entering the rate limiter. This is intentional: rate limiting protects the remote server, not your disk. Reading from disk is free and fast. However, cache hits still enter the pipeline; your parse task runs, extraction happens, and files are written.

Concurrent write semantics: If two tasks attempt to cache the same URL simultaneously, the last write wins (second task's body overwrites the first). There's no lock or transaction around cache writes. For a single orchestrator run this isn't an issue because each URL is processed once per concurrency slot. If you run multiple Ripperoni instances against the same cache directory, they'll interfere with each other; use separate cache directories per instance or disable the cache for concurrent runners.

## TTL

```json
"cache": {
  "dir":   "./output/.cache/aonprd",
  "mode":  "read-write",
  "ttlMs": 86400000
}
```

`ttlMs` is in milliseconds. An entry older than `ttlMs` is treated as a miss on read; the fetcher goes to the network and overwrites the entry. Omit `ttlMs` for no expiration.

`86400000` = 24 hours. `604800000` = 7 days.

Stale-entry behavior: When you read a cached entry, its timestamp is checked against the current time. If `now - fetchedAt > ttlMs`, the entry is treated as a cache miss. The fetcher re-fetches the URL and overwrites the old entry with a new `fetchedAt` timestamp. The old file is replaced atomically. This is called "write-through" expiration: you only refresh entries when you try to use them, not on a background schedule.

## LRU eviction

When `maxEntries` is set (programmatic use only; not in the JSON config schema), the cache evicts the oldest entries by `fetchedAt` on write. The JSON config only exposes `dir`, `mode`, and `ttlMs`.

## Cache key

The key is derived from `{ method, url }`; the same URL always maps to the same key. Ripperoni only GETs, so in practice the key is the URL hash.

```ts
const key = ScraperCache.keyFor({ method: 'GET', url });
```

## Workflow

First run; cache cold:

```
html:fetch → cache miss → HTTP GET → store in cache → hand HTML to parse task
```

Subsequent runs; cache warm:

```
html:fetch → cache hit → return cached HTML → hand HTML to parse task
```

Network is never touched on a cache hit. This makes iterating on your parse plugin fast; change the plugin, rerun, no waiting.

## Cache directory structure

```
output/.cache/aonprd/
  a3/
    b7c9d2e1f4.meta.json
    b7c9d2e1f4.body
  7f/
    1e8a3c5b29.meta.json
    1e8a3c5b29.body
```

The shard prefix keeps each subdirectory small enough that `readdir()` stays fast even with tens of thousands of entries.

## Read-only mode failure modes

When `mode: "read-only"` is set, the cache will not write new entries. If a fetch request for a URL that isn't in the cache occurs, the fetcher throws an error immediately; there's no fallback to the network. This is useful for offline development where you've pre-cached a known set of URLs and want to catch typos in your config (a new URL will surface the error immediately, not silently hit the network).

## Clearing the cache

Delete the cache directory:

```bash
rm -rf ./output/.cache/aonprd
```

Or switch `mode` to `write-only` for one run to refresh all entries. In `write-only` mode, every URL is fetched fresh and cached, overwriting any stale entries. This is faster than deleting the directory if you want to do a full refresh without losing directory structure.

## Related

- [Scrapers](./scrapers); how HtmlScraper uses the cache
- [Configuration](./configuration); cache config schema
