---
layout: doc
title: Orchestration
---

# Orchestration

Ripperoni uses `@studnicky/dagonizer` for all scrape orchestration. Each run is a directed acyclic graph (DAG) dispatched by `RipperDagonizer`.

## How it works

1. `runHtml(opts)` / `runWiki(opts)` (in `src/run/`) reads `pipeline: string[]` from the target config.
2. Built-in nodes (`html:fetch`, `json:write`, etc.) are always registered. Non-built-in entries resolve to plugin files (`./plugins/<word>/<verb>.task.js`); each plugin's `export function register(dispatcher)` is invoked.
3. A **composite per-item node** is built from the ordered pipeline list. It executes each configured node in sequence for one URL or wiki title.
4. A **fan-out DAG** is built that fans over `state.urls` (HTML) or `state.titles` (wiki), running the composite node per item with configurable concurrency.
5. `state.succeeded` and `state.failed` are populated by the `partition` fan-in strategy.
6. After dispatch, `failures.json` is written if any items failed.

## Config surface (unchanged from v2)

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

The `pipeline` array is the only config surface. Step order is preserved. Each name must resolve to a registered `NodeInterface`.

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

## Error routing

In the composite per-item node, any port other than `success` (including `error`, `invalid`, `cached`, `skipped`) terminates the remaining steps for that item and records it as a failure. This ensures write nodes never run on a partially-processed page.

## State checkpoint support

`ScrapeState` extends `NodeStateBase` and implements `snapshotData()` / `restoreData()`. Long runs interrupted mid-fan-out can be resumed from a checkpoint using dagonizer's `Checkpoint` API. The `failures.json` manifest provides a simpler recovery path for most use cases: re-run with `--resume-failures` to retry only failed items.

## Concurrency

Fan-out concurrency defaults:
- HTML runs: 4 concurrent URLs.
- Wiki runs: 8 concurrent titles (batched in 50-title API calls).

Override via `target.concurrency` in config (not yet exposed via the fan-out placement; currently a hardcoded default in the DAG factory).

## Related

- [Plugins](/usage/plugins) — write a custom `NodeInterface`
- [Scrapers](/usage/scrapers) — how `HtmlScraper` and `MediaWikiScraper` work
- [Architecture](/architecture) — DAG topology diagrams
