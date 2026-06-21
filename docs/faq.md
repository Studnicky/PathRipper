---
title: FAQ
---

# FAQ

## What is Ripperoni and what does it do?

Fresh from the block: Ripperoni is a web-scraping engine built on [@studnicky/dagonizer](https://github.com/Studnicky/Dagonizer). Point it at a wiki, a site, or a URL list and it hands you one structured JSON record per page, written to disk. It handles discovery (crawling), fetching, parsing, and writing through a configurable pipeline. Pair it with Squashage and those JSON records become an RDF graph. Ripperoni does the scraping and structuring; Squashage does the semantic conversion.

## What is a pipeline or DAG?

A pipeline is the ordered list of task identifiers in your config that describe what happens to each page — fetch it, parse it, write it. Ripperoni compiles that list into a DAG (directed acyclic graph) using dagonizer's `DAGBuilder`: each task becomes a node, wired in sequence so data flows from one step to the next without cycles. You define the pipeline; dagonizer handles the execution graph. The `pipeline` array in your target config is where you declare it.

## How do I run a scrape?

```sh
ripperoni scrape --target <name> --config ripperoni.config.json
```

`scrape` detects whether the named target lives under `targets` (HTML) or `mediawiki` in the config and dispatches accordingly. Pass `--out <dir>` to override the output directory without touching the config. The `scrape-html` and `scrape-wiki` commands do the same thing with their mode forced, if you prefer to be explicit.

## How do I point Ripperoni at a new site?

Add a named entry under `targets` in your config:

```json
{
  "output": { "basePath": "./output" },
  "targets": {
    "my-site": {
      "baseUrl": "https://example.com",
      "rateLimitMs": 500,
      "pipeline": ["html:fetch", "my-site:parse", "json:write"]
    }
  }
}
```

`baseUrl` is the root all relative paths resolve against. `pipeline` is the ordered list of task identifiers Ripperoni compiles into a per-page DAG with dagonizer's `DAGBuilder` — one node per step, wired in order. The schema (`output.basePath` is required; everything else is optional) is validated before any network activity starts, so config mistakes surface immediately. See [Configuration](/usage/configuration) for the full field reference.

## How do I make it crawl a whole site?

Add `crawl:list-targets` as the first pipeline step, then add a `crawler` block to the target:

```json
"pipeline": ["crawl:list-targets", "html:fetch", "my-site:parse", "json:write"],
"crawler": {
  "startUrls": ["https://example.com/index"],
  "domain": "example\\.com",
  "target": "\\?id=",
  "delimiter": "category",
  "rateLimitMs": 100,
  "jitterMs": 25,
  "maxPages": 500
}
```

`domain`, `target`, and `delimiter` are regular expression strings. The crawler follows links that match `domain`, collects those that also match `target`, and uses `delimiter` to segment traversal. Discovery runs first; once the URL list is built, the rest of the pipeline processes each page. See [Crawler](/usage/crawler) for detail on how the frontier expands level by level.

## My crawl ran long and grabbed the entire site. How do I bound it?

Set `crawler.maxPages` to cap the haul. The `DedupeAndEnqueueNode` checks the collected count after every frontier level and stops as soon as it hits the cap — no more URLs enter the queue. Without `maxPages`, the crawler follows every link until the frontier is exhausted.

The `--max` flag on the standalone `crawl` command does the same thing for ad-hoc link discovery runs.

## Can I scrape just a handful of URLs without crawling?

Sometimes you want a few choice cuts, not the whole carcass. Pass `--paths` on the command line:

```sh
ripperoni scrape --target my-site --paths /items/42 /items/99
```

When `--paths` is present the crawl phase is skipped entirely, even if the pipeline declares `crawl:list-targets`. The paths are resolved against `baseUrl` and fed straight into the fetch phase. `scrape-html` requires `--paths` and never crawls; use it when you already know what you want.

## Where do the JSON records land?

Records land under `output.basePath` from the config, in a subdirectory named after the target. So `basePath: ./output` and `target: my-site` means records land in `./output/my-site/`. Pass `--out <dir>` at the command line to override `basePath` for that run without touching the config file. Set `output.pretty: true` to get human-readable indented JSON instead of compact output.

## How do I re-run without re-fetching everything?

Configure a cache on the target:

```json
"cache": {
  "dir": "./output/.cache/my-site",
  "mode": "read-write",
  "ttlMs": 86400000
}
```

`read-write` serves cached responses and stores new ones. `read-only` serves cache hits but never writes (useful for a re-parse pass). `write-only` always fetches from the network and overwrites whatever is cached. `off` disables the cache entirely. The cache is content-addressed by a SHA-1 of method + URL + headers, sharded two levels deep under `dir`. See [Cache](/usage/cache).

## What happens to pages that fail?

Every cut gets one more chance. Each page gets one retry on failure. After the run, `state.succeeded`, `state.recovered`, and `state.failedAfterRetry` carry the per-page outcomes. Any URL still in `failedAfterRetry` is written to `failures.json` in the target output directory. On the next run, pass `--resume-failures` to re-scrape exactly those URLs and nothing else — no crawl, no full re-fetch. Just the stubborn bits.

## Why is parsing using all my cores?

That's the grinder doing its job. By design, when the compiled worker registry is present (`dist-workers/`), Ripperoni routes the CPU-bound plugin parse step into a `WorkerThreadContainer` pool. The pool is sized by `NodeSystemInfo.recommendedWorkerCount`, which factors in `availableParallelism()`, memory, and a main-thread reservation — so on a 16-core host you get roughly 15 parse workers running in parallel while the coordinator handles fetch and write. Build the worker tree with `npm run build:workers` if the pool is not activating. In-process fallback kicks in automatically when the registry is absent.

## How do I write a plugin?

Export a `register(dispatcher)` function that calls `dispatcher.registerNode(...)` for each node and `dispatcher.registerDAG(...)` for the parse DAG. Nodes extend `ScalarNode` from `@studnicky/dagonizer`. Name your parse task `<target>:parse` and add it to the pipeline array in the config — Ripperoni resolves it from the registry at dispatch time. The AONPRD plugin (`plugins/aonprd/parse.task.ts`) is the canonical example: it registers all taxonomy-compiled nodes and the `aonprd:parse` DAG in a single `register` call. See [Plugins](/usage/plugins).

## Does it do MediaWiki?

Yes — declare the target under `mediawiki` instead of `targets`, set `apiUrl` to the MediaWiki Action API endpoint (typically ending in `/w/api.php`), and list `categories` to scope which pages are fetched. `batchSize` controls how many pages come back per API call (max 50 for unprivileged users). The same cache, retry, and rate-limiting options apply. See [MediaWiki](/usage/mediawiki).

## How does it avoid hammering the target server?

Two levers: `rateLimitMs` sets the minimum gap between consecutive requests to a target. `jitterMs` adds a random offset drawn from `[0, jitterMs)` on top of that, spreading requests so multiple workers hitting the same host don't land in lockstep. Both apply independently to the scraper and to the embedded crawler. On top of that, `HttpRetryPolicy` observes `Retry-After` response headers and respects the server's requested backoff before any retry attempt.

## What is the difference between a target and a crawler?

A target is the full specification of what to fetch, how to parse it, and where to write it — `baseUrl`, `pipeline`, `cache`, `rateLimitMs`, `headers`, all of it. A crawler is the discovery mechanism embedded inside the target under the `crawler` key; it has its own `startUrls`, regex patterns, and rate-limit settings, separate from the parent target's. A target without a `crawler` block expects URLs supplied via `--paths`. A target with one runs discovery first, then feeds the collected URL list into the pipeline. See [Crawler](/usage/crawler) and [Configuration](/usage/configuration).
