---
title: AONPRD Scraper DAG
description: A visual, top-down walkthrough of how the Archives of Nethys (Pathfinder 2e) scrape is wired — from the orchestration document down to the taxonomy-routed parse DAG.
---

# AONPRD Scraper DAG

Here is one real scraper on the block, top to bottom — from the orchestration document down to the cut that lands on disk.

This page walks the Archives of Nethys (Pathfinder 2e) scrape end to end. Every
diagram below is generated at build time from the **real DAG definitions** by
[`@studnicky/dagonizer`](https://github.com/Studnicky/Dagonizer)'s `MermaidRenderer`
(`docs/.vitepress/scripts/render-dags.mjs`), so the pictures always match the code.

A **DAG** (directed acyclic graph) is a set of steps (**nodes**) connected by
one-way edges — execution flows forward through the graph with no cycles. A
**scatter** fans one node out over a list so every item runs the same sub-DAG in
parallel. An **embedded DAG** is a full DAG dropped into a single node slot of an
outer DAG, so the outer graph stays readable while the inner graph handles its own
complexity.

A run is several DAGs nested inside each other. Reading top to bottom: the
**orchestration** document embeds the built-in **`crawl:discover`** DAG (which
discovers all target URLs via cyclic BFS), then **scatters** over those URLs
running the **`aonprd:page`** plugin DAG, which in turn embeds the
**`aonprd:parse`** taxonomy-routed parse DAG to turn HTML into a typed record.

## The orchestration document

The run is driven by two files:

- **Orchestration**: `tests/e2e/fixtures/aonprd-crawl.dag.jsonld`
- **State**: `tests/e2e/fixtures/aonprd-crawler.state.json`

Run command:

```bash
ripperoni run tests/e2e/fixtures/aonprd-crawl.dag.jsonld \
  --state tests/e2e/fixtures/aonprd-crawler.state.json
```

The orchestration declares one DAG (`aonprd:crawl`) with three nodes: an
`EmbeddedDAGNode` that runs `crawl:discover`, a `ScatterNode` that fans over
discovered URLs running `aonprd:page`, and a terminal. The state supplies all
runtime parameters — `baseUrl`, `headers`, rate limits, the `crawler` block, and
output config.

## 1 · The embedded `crawl:discover` DAG

The orchestration's first node is:

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

`crawl:discover` is a built-in cyclic DAG loaded by `PluginLoader.registerBuiltinNodes`
at run time from `src/crawlers/crawl-discover.dag.jsonld`. It runs a level-by-level
BFS: fetch each frontier page, extract links matching the crawler's `delimiter`
(traversable) and `target` (collectable `?ID=` pages), deduplicate, and promote the
next frontier via a back-edge until the frontier empties or the `maxPages` bound is
hit. The `crawler` block in `state.json` configures the seed URLs, regex patterns,
rate limits, and cap.

The crawl shape:

```
crawl:init-frontier
  ready → crawl:fetch-and-extract
  empty → crawl:exhausted

crawl:fetch-and-extract
  success / empty / error / permanent → crawl:dedupe-and-enqueue

crawl:dedupe-and-enqueue
  frontier-ready   → crawl:fetch-and-extract   ← back-edge (the loop)
  frontier-empty   → crawl:exhausted
  budget-exhausted → crawl:exhausted

crawl:exhausted → crawl:completed (terminal)
```

The back-edge from `crawl:dedupe-and-enqueue` to `crawl:fetch-and-extract` is a
native cyclic edge. The engine re-executes on in-place state until
`crawl:dedupe-and-enqueue` routes to `crawl:exhausted`.

After completion, the `stateMapping` writes `crawl.discovered` into `state.urls`,
which the scatter node reads.

## 2 · The scatter — `ScatterNode { body: { dag: "aonprd:page" } }`

The second node fans over `state.urls`:

```json
{
  "@type":     "ScatterNode",
  "name":      "scrape",
  "source":    "urls",
  "body":      { "dag": "aonprd:page" },
  "container": "worker",
  "itemKey":   "currentUrl",
  "gather": {
    "strategy":   "partition",
    "partitions": { "success": "succeeded", "error": "failed" }
  },
  "reducer": "aggregate",
  "outputs": {
    "all-success": "done",
    "partial":     "done",
    "all-error":   "done",
    "empty":       "done"
  }
}
```

`container: "worker"` routes each item to the `WorkerThreadContainer` pool when
`parallelWorkers: true` is set in state and `npm run build:workers` has been run.
Items partition into `state.succeeded` / `state.failed` via the `partition` gather
strategy.

## 3 · The `aonprd:page` plugin DAG

`plugins/aonprd/page.dag.jsonld` declares the per-page pipeline. Each URL passes
through three steps:

| Step | What it does |
|------|-------------|
| `html:fetch` | Rate-limited fetch with retry + backoff. Respects `Retry-After`. Reads from cache on hits (`success` and `cached` both proceed). |
| `aonprd:parse` (embedded) | The embedded parse DAG. Input `page` maps to the page state; output `output` maps back to the parent for `json:write`. |
| `json:write` | Writes `state.output` to `output/aonprd/<slug>.json`. `skipped` when `state.output` is null. |

Any `error` port routes to the `aonprd-page:failed` terminal, which the scatter's
`partition` gather picks up as a failed item.

## 4 · The `aonprd:parse` plugin DAG — the meaty bit

`plugins/aonprd/parse.dag.jsonld` is the taxonomy-routed parse DAG. It is
**taxonomy-routed**: the entrypoint `aonprd:taxonomy-route` classifies each page
from its URL and dispatches to that concept's inherited capability chain (spell,
monster, feat, weapon, …). Pages that match no known concept route to
`aonprd:make-unknown`. The DAG is compiled from the concept taxonomy by
`TAXONOMY.buildDAG()` — adding a concept extends the taxonomy rather than this
diagram by hand.

```mermaid
<!--@include: ./_generated/aonprdParseDAG.mmd -->
```

The parsed record copies back to the per-page state via the embedded DAG's output
mapping, so the downstream `json:write` step sees the typed output and writes one
JSON record per page.

## See also

- [Architecture](/architecture) — the full DAG model, HTTP machinery, and scrapers.
- [Authoring a DAG](/usage/pipeline) — placement types, `DAGBuilder` API, built-in nodes.
- [Crawler](/usage/crawler) — configuring `startUrls`, `target`, `delimiter`, and bounds.
