---
title: AONPRD Scraper DAG
description: A visual, top-down walkthrough of how the Archives of Nethys (Pathfinder 2e) scrape is wired — from CLI dispatch down to the taxonomy-routed parse DAG.
---

# AONPRD Scraper DAG

Here's one real scraper on the block, top to bottom — from the butcher's run down to the cut that lands on disk.

This page walks the Archives of Nethys (Pathfinder 2e) scrape end to end. Every
diagram below is generated at build time from the **real DAG definitions** by
[`@studnicky/dagonizer`](https://github.com/Studnicky/Dagonizer)'s `MermaidRenderer`
(`docs/.vitepress/scripts/render-dags.mjs`), so the pictures always match the code.

A **DAG** (directed acyclic graph) is a set of steps (**nodes**) connected by
one-way edges — execution flows forward through the graph with no cycles. A
**scatter** fans one node out over a list so every item runs the same subgraph in
parallel. An **embedded DAG** is a full DAG dropped into a single node slot of an
outer DAG, so the outer graph stays readable while the inner graph handles its own
complexity. All of the diagrams here are rendered by dagonizer's own visualizer and
show the exact runtime graph the scraper executes.

A run is several DAGs nested inside each other. Reading top to bottom: the **CLI**
dispatches an **outer flow**, the outer flow embeds three **phase** DAGs (discovery →
scrape → retry), each scrape/retry phase scatters over its URL set and runs a
**per-page** DAG, and the per-page DAG embeds the **`aonprd:parse`** plugin DAG to
turn HTML into a typed record.

## The target

The aonprd scrape lives entirely in config:

```json
{
  "targets": {
    "aonprd": {
      "baseUrl": "https://2e.aonprd.com",
      "pipeline": ["crawl:list-targets", "html:fetch", "aonprd:parse", "json:write"],
      "crawler": {
        "startUrls": ["https://2e.aonprd.com/Spells.aspx", "..."],
        "domain": "2e\\.aonprd\\.com",
        "target": "\\?ID=",
        "delimiter": "\\.aspx"
      }
    }
  }
}
```

Because the `pipeline` begins with `crawl:list-targets`, the orchestrator selects
the **crawl** outer flow: it first discovers every `?ID=` detail URL reachable from
`startUrls`, then scrapes each one through `html:fetch → aonprd:parse → json:write`.

## 1 · CLI dispatch

The CLI is itself a DAG. The `scrape` action builds a `CliState`, registers the CLI
nodes and `cliScrapeDAG`, and dispatches. `resolve-target` finds `aonprd` in
`targets` and routes to the HTML scrape; every outcome flows to `write-manifest`,
then `exit` sets the process exit code.

```mermaid
<!--@include: ./_generated/cliScrapeDAG.mmd -->
```

## 2 · Outer flow — `htmlScrapeDAGCrawl`

The crawl outer flow embeds three phase DAGs as native `embeddedDAG` placements,
each with explicit `inputs`/`outputs` state mappings: **crawl** discovers URLs into
`state.urls`, **scrape** processes them, **retry** handles first-attempt failures.
The phases are gated — `crawl:list-targets` runs to completion before the scrape
phase fans out.

```mermaid
<!--@include: ./_generated/htmlScrapeDAGCrawl.mmd -->
```

## 3 · Phases

### 3a · Discovery — `htmlCrawlPhase`

A single `crawl:list-targets` node populates `state.urls`. It drives the link
crawler (below), then terminates so the scrape phase can begin.

```mermaid
<!--@include: ./_generated/htmlCrawlPhase.mmd -->
```

`crawl:list-targets` runs the **link crawler DAG** — a level-by-level BFS that
fetches each frontier page, extracts links matching the crawler's `delimiter`
(traversable) and `target` (collectable `?ID=` pages), dedupes, and promotes the
next frontier via a back-edge until the frontier empties or a `maxPages`/`maxDepth`
bound is hit. With no bound configured it traverses the full reachable `.aspx` graph.

```mermaid
<!--@include: ./_generated/linkCrawlDAG.mmd -->
```

### 3b · Scrape — `htmlScrapePhase`

The scrape phase scatters over `state.urls` using a native `{ dag }` scatter body —
each item runs the per-page DAG directly as an embedded DAG. The fetch node reads its
URL from the scatter's `currentUrl` item key. Outcomes partition into
`state.succeeded` / `state.failed`. Scatter concurrency matches the parse
worker-pool width, so every worker stays fed.

```mermaid
<!--@include: ./_generated/htmlScrapePhase.mmd -->
```

### 3c · Retry — `htmlRetryPhase`

Items that fail their first attempt scatter once more, partitioning into
`state.recovered` and `state.failedAfterRetry`. The same per-page DAG runs; only the
scatter source (`state.failed`) differs. `failures.json` is written from
`state.failedAfterRetry`.

```mermaid
<!--@include: ./_generated/htmlRetryPhase.mmd -->
```

## 4 · Per-page DAG

Each phase item runs the per-page DAG compiled from the target's `pipeline`. For
aonprd that is `html:fetch → aonprd:parse → json:write`: the cache-aware fetch
(`success`/`cached` both proceed), the embedded `aonprd:parse` DAG (`[[double
border]]`), and the JSON writer. Any `error` routes to the page's `failed` terminal,
which the retry phase picks up.

```mermaid
<!--@include: ./_generated/aonprdPageDAG.mmd -->
```

## 5 · `aonprd:parse` plugin DAG — the meaty bit

`aonprd:parse` is a registered plugin DAG, embedded in the per-page
pipeline. It is **taxonomy-routed**: the entrypoint `aonprd:taxonomy-route`
classifies each page from its URL and dispatches to that concept's inherited
capability chain (spell, monster, feat, weapon, …). Pages that match no known
concept route to `aonprd:make-unknown`. The DAG is compiled from the concept
taxonomy by `TAXONOMY.buildDAG()` — adding a concept extends the taxonomy, not this
diagram by hand.

```mermaid
<!--@include: ./_generated/aonprdParseDAG.mmd -->
```

The parsed record copies back to the per-page state via the embedded DAG's output
mapping, so the downstream `json:write` step sees the typed output and writes one
JSON record per page.

## See also

- [Architecture](/architecture) — the full DAG model, HTTP machinery, and scrapers.
- [Pipeline](/usage/pipeline) — how a `pipeline: [...]` list becomes a per-page DAG.
- [Crawler](/usage/crawler) — configuring `startUrls`, `target`, `delimiter`, and bounds.
