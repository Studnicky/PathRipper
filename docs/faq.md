---
title: FAQ
---

# FAQ

## What is Ripperoni and what does it do?

Fresh from the block: Ripperoni is a web-scraping engine built on [@studnicky/dagonizer](https://github.com/Studnicky/Dagonizer). Point it at a wiki, a site, or a URL list and it hands you one structured JSON record per page, written to disk. It handles discovery (link crawling), fetching, parsing, and writing through an authored DAG document. Pair it with Squashage and those JSON records become an RDF graph. Ripperoni does the scraping and structuring; Squashage does the semantic conversion.

## What is a DAG?

A DAG (directed acyclic graph) is a set of steps (nodes) connected by one-way edges — execution flows forward through the graph with no cycles. In Ripperoni, a DAG document (a JSON-LD file) is the program: it declares which nodes run, in what order, with which fan-out strategy. You author DAG documents with `DAGBuilder`, serialize them with `DAGDocument.serialize()`, and commit the resulting `*.dag.jsonld` files. The dagonizer engine executes them at run time.

## How do I run a scrape?

```sh
ripperoni run <orchestration>.dag.jsonld --state <run>.state.json
```

Pass `--out <dir>` to override `output.basePath` from the state file for a single run.

## How do I scaffold a new run?

```sh
ripperoni scaffold mysite
```

This writes `mysite.dag.jsonld` (starter orchestration) and `mysite.state.json` (starter state). Edit both for your target site, then run.

## How do I point Ripperoni at a new site?

1. Run `ripperoni scaffold mysite`.
2. Edit `mysite.state.json`: set `baseUrl`, rate limits, cache, and output.
3. Author the orchestration in `mysite.dag.jsonld`: wire the `crawl:discover` embedded DAG (or start with a `urls` list) and scatter over your plugin's per-page DAG.
4. Write a plugin under `plugins/mysite/`: a `ScalarNode` subclass, a `*.dag.jsonld` per-page DAG, and `index.ts` exporting `register(dispatcher)`.

## How do I crawl a whole site?

Embed `crawl:discover` in your orchestration DAG:

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

Then add a `crawler` block to `state.json`:

```json
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

`domain`, `target`, and `delimiter` are regular expression strings. The crawler follows links that match `domain` + `delimiter`, collects those that also match `target`, and seeds `state.urls` with the results after the crawl completes.

## My crawl ran long and grabbed the entire site. How do I bound it?

Set `crawler.maxPages` in `state.json` to cap the haul. The `crawl:dedupe-and-enqueue` node checks the collected count after every frontier level and stops as soon as it hits the cap — no more URLs enter the queue. Without `maxPages`, the crawler follows every link until the frontier is exhausted.

## Can I scrape just a handful of URLs without crawling?

Put `urls` directly in `state.json` and omit the `crawler` block. No `crawl:discover` node is needed in the orchestration — the scatter reads directly from `state.urls`:

```json
{
  "baseUrl":  "https://example.com",
  "urls": [
    "https://example.com/items/42",
    "https://example.com/items/99"
  ]
}
```

Start the orchestration DAG at the scatter node rather than the discover node.

## Where do the JSON records land?

Records land under `output.basePath` from `state.json`, in a subdirectory named after the plugin's task. Pass `--out <dir>` at the command line to override `basePath` for that run. Set `output.pretty: true` to get human-readable indented JSON instead of compact output.

## How do I re-run without re-fetching everything?

Set a `cache` block in `state.json`:

```json
"cache": {
  "dir": "./output/.cache/my-site",
  "mode": "read-write",
  "ttlMs": 86400000
}
```

`read-write` serves cached responses and stores new ones. `read-only` serves cache hits but never writes (useful for a re-parse pass). `write-only` always fetches from the network and overwrites whatever is cached. `off` disables the cache entirely. See [Cache](/usage/cache).

## What happens to pages that fail?

After a run, `state.succeeded` and `state.failed` carry the per-page outcomes. Any URL still in `state.failed` is written to `failures.json` in the output directory. On the next run, create a fresh state file with `urls: [...]` pointing at the failed URLs, then re-run — only those pages are processed, no crawl needed.

## Why is parsing using all my cores?

Set `parallelWorkers: true` in `state.json` and build the worker registry with `npm run build:workers`. Ripperoni routes the CPU-bound parse step into a `WorkerThreadContainer` pool. The pool size is determined by `NodeSystemInfo.recommendedWorkerCount`, which factors in `availableParallelism()`, memory, and a main-thread reservation. On a 16-core host you get roughly 15 parse workers running in parallel while the coordinator handles fetch and write. In-process fallback kicks in automatically when the registry is absent.

## How do I write a plugin?

1. Create `plugins/<namespace>/index.ts` and export `register(dispatcher)` — call `dispatcher.registerNode(...)` for each node instance. Do not call `dispatcher.registerDAG` here; DAGs come from files.
2. Write your parse node as a `ScalarNode` subclass. `executeOne` reads `state.page.html` and writes `state.output`.
3. Author the per-page DAG with `DAGBuilder`, serialize it with `DAGDocument.serialize()`, and commit the `*.dag.jsonld` file alongside the plugin source.
4. Reference the plugin's per-page DAG name in your orchestration's `ScatterNode.body.dag`.

The AONPRD plugin (`plugins/aonprd/`) is the reference implementation: it registers all taxonomy-compiled nodes in `register()`, and provides committed `page.dag.jsonld` and `parse.dag.jsonld` documents. See [Plugins](/usage/plugins).

## Does it do MediaWiki?

Yes — set `apiUrl` to the MediaWiki Action API endpoint in `state.json` (typically ending in `/w/api.php`). The built-in `wiki:fetch` node uses `MediaWikiScraper` to batch-fetch wikitext pages. Author an orchestration that scatters over a `urls` list (title list) or embeds a discovery node before the scatter. The same cache, retry, and rate-limiting options apply. See [MediaWiki](/usage/mediawiki).

## How does it avoid hammering the target server?

Two levers in `state.json`: `rateLimitMs` sets the minimum gap between consecutive requests. `jitterMs` adds a random offset drawn from `[0, jitterMs)` on top of that, spreading requests so multiple workers hitting the same host don't land in lockstep. Both apply independently to the scraper and to the embedded crawler. `HttpRetryPolicy` observes `Retry-After` response headers and respects the server's requested backoff before any retry attempt.
