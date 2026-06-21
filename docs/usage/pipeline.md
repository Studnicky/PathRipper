---
layout: doc
title: Orchestration
---

# Orchestration

Ripperoni is a butcher for the web. The pipeline is its cutting line: raw HTML in one end, clean JSON out the other — every step doing exactly one job on the way through.

A **pipeline** is the ordered list of step names you declare in config. Ripperoni compiles that list into a [dagonizer](https://github.com/Studnicky/Dagonizer) DAG — a directed acyclic graph (DAG) in which each step becomes a **node** wired to the next in sequence. The DAG is what actually runs. Steps that name a registered plugin DAG (like `aonprd:parse`) become **embedded DAG** placements — a full child DAG dropped in-place as a single logical node. Fan-out over many URLs is handled by a native dagonizer **scatter** node that runs the per-page DAG once per URL in parallel.

Ripperoni drives all scrape orchestration through [`@studnicky/dagonizer`](https://github.com/Studnicky/Dagonizer). Each run is a DAG dispatched by `RipperDagonizer`, built via `DAGBuilder`.

## How a pipeline becomes a DAG

1. `runHtml(opts)` / `runWiki(opts)` (in `src/run/`) reads `pipeline: string[]` from the target config.
2. Built-in nodes (`html:fetch`, `json:write`, etc.) register automatically. Non-built-in entries resolve to plugin modules (`./plugins/<name>/`); each plugin's `export function register(dispatcher)` runs on load. Pipeline entries that name a registered DAG (e.g. `aonprd:parse`) become `embeddedDAG` placements.
3. A **per-page child DAG** (`htmlPageDAG:<targetId>`) builds from the ordered pipeline list via `DAGBuilder`. Each step wires as a node placement or an `embeddedDAG` placement; non-success ports route to a `htmlPage:failed` terminal, success ports chain to the next step.
4. A **scatter phase DAG** (`htmlScrapePhase`) fans over `state.urls`, running the per-page child DAG once per URL via a native `{ dag }` scatter body with a `partition` gather that writes results into `state.succeeded` / `state.failed`. Across pages, the whole per-page line runs at once — as many links in the chain as the worker crew is wide.
5. A **retry phase DAG** (`htmlRetryPhase`) repeats the same scatter over `state.failed`, writing into `state.recovered` / `state.failedAfterRetry`.
6. The outer composition DAG sequences the phase DAGs as embedded DAG placements, then terminates. When `crawl:list-targets` is in the pipeline and no `--paths` override is supplied, the engine selects the crawl-path outer DAG (`htmlScrapeDAGCrawl`); otherwise it uses the no-crawl outer DAG (`htmlScrapeDAG`).
7. After dispatch, `failures.json` is written if any items remain in `state.failedAfterRetry`.

## Config surface

```json
{
  "targets": {
    "mysite": {
      "baseUrl": "https://example.com",
      "pipeline": ["html:fetch", "html:write-raw", "mysite:parse", "json:write"]
    }
  }
}
```

The `pipeline` array is the only config surface — a short, ordered list that defines the whole run. Step order is preserved. Each name must resolve to a registered `NodeInterface` or a registered DAG. Plugin DAG steps (e.g. `mysite:parse`) place via `.embeddedDAG()` in the per-page child DAG; their `output` field maps back to the parent state so downstream write nodes see the parsed result.

## Built-in nodes

| Node name | Ports | Description |
|-----------|-------|-------------|
| `html:fetch` | `success \| error \| cached` | Fetches `state.page.url` via `HtmlScraper` |
| `wiki:fetch` | `success \| error` | Fetches `state.page.title` via `MediaWikiScraper` |
| `html:write-raw` | `success` | Writes raw HTML to `<outDir>/<target>/raw/<slug>.html` |
| `wiki:write-raw` | `success` | Writes raw wikitext to `<outDir>/<target>/raw/<slug>.txt` |
| `json:write` | `success \| skipped` | Writes `state.output` as JSON; skips when `null` |
| `jsonl:append` | `success \| skipped` | Appends `state.output` to a JSONL file |
| `validate:schema` | `valid \| invalid` | Validates `state.output` against a JSON schema |
| `crawl:list-targets` | `success \| error \| empty` | Crawls seed URLs via `LinkLister`; populates `state.urls` |

## Error routing and failure terminal

In the per-page child DAG, any port outside the continuation set (`success`, `cached`, `skipped`, `valid`) routes to the `htmlPage:failed` terminal and ends processing for that item. Write nodes run only on fully-processed pages. The scatter's `partition` gather collects `failed` terminal outcomes into `state.failed` for the retry phase.

## Fan-out and scatter

Per-item fan-out is a native dagonizer scatter: the phase DAG places a `scatter` step whose body is `{ dag: '<perPageDagName>' }`. The scatter runs the per-page child DAG once per URL, up to `concurrency` items simultaneously, then applies the `partition` gather strategy. When a step names a registered DAG (like `aonprd:parse`), the runner drops it in as an `embeddedDAG` placement and feeds its output to the next step.

## Concurrency

Scatter concurrency defaults:
- HTML runs: 4 concurrent URLs (in-process path).
- HTML runs with worker pool: pool size (system-sized from `NodeSystemInfo.recommendedWorkerCount`).
- Wiki runs: 8 concurrent titles (batched in 50-title API calls).

Override via `target.concurrency` in config.

## Related

- [Plugins](/usage/plugins) — write a custom `NodeInterface`
- [Scrapers](/usage/scrapers) — how `HtmlScraper` and `MediaWikiScraper` work
- [Architecture](/architecture) — DAG topology diagrams
