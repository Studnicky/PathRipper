---
layout: doc
title: Authoring a DAG
---

# Authoring a DAG

A DAG document is the program. You author it with `DAGBuilder`, serialize it with `DAGDocument.serialize()`, and commit the resulting `*.dag.jsonld` file. The runner loads it at startup and dispatches it via the dagonizer engine. No pipeline array, no config compilation — the document is the execution graph.

Ripperoni drives all scrape orchestration through [`@studnicky/dagonizer`](https://github.com/Studnicky/Dagonizer). Each run is a DAG dispatched by `RipperDagonizer`, built via `DAGBuilder`.

## Placement types

A DAG document is a set of named placements wired by output routes.

| Placement type | `@type` | Description |
|---------------|---------|-------------|
| `SingleNode` | `"SingleNode"` | Runs a registered node instance. `node` field names the registered node. |
| `ScatterNode` | `"ScatterNode"` | Fans over a list (`source` field) running the body sub-DAG once per item. |
| `EmbeddedDAGNode` | `"EmbeddedDAGNode"` | Drops a full registered DAG in-place as a single logical step. |
| `TerminalNode` | `"TerminalNode"` | Ends processing for a path. `outcome` is `"completed"` or `"failed"`. |

## DAGBuilder API

```ts
import { DAGBuilder, DAGDocument } from '@studnicky/dagonizer';

const dag = new DAGBuilder('ns:name', '1.0')
  .entrypoint('first-node')                              // set the entry placement name
  .node('html:fetch', HtmlFetchNode, {                   // SingleNode placement
    success: 'next-step',
    error:   'my-dag:failed',
  })
  .embeddedDAG('my-parse', 'myplugin:parse', {          // EmbeddedDAGNode placement
    success: 'json:write',
    error:   'my-dag:failed',
  }, {
    inputs:  { page: 'page' },
    outputs: { output: 'output' },
  })
  .scatter('fan-out', {                                  // ScatterNode placement
    source:    'urls',
    body:      { dag: 'myplugin:page' },
    container: 'worker',
    itemKey:   'currentUrl',
    gather:    { strategy: 'partition', partitions: { success: 'succeeded', error: 'failed' } },
    reducer:   'aggregate',
    outputs:   { 'all-success': 'done', partial: 'done', 'all-error': 'done', empty: 'done' },
  })
  .terminal('my-dag:completed', { outcome: 'completed' })
  .terminal('my-dag:failed',    { outcome: 'failed' })
  .build();

// Serialize to a committed *.dag.jsonld file:
const jsonld = DAGDocument.serialize(dag);
```

`DAGBuilder` methods chain. Call `.build()` once when the graph is complete. Pass the result to `DAGDocument.serialize()` to produce the JSON-LD string; write it to a `*.dag.jsonld` file and commit it. The runner loads the file at startup via `PluginLoader`.

## Built-in nodes

These nodes are always registered by `PluginLoader.registerBuiltinNodes` — reference them by name in any DAG document:

| Node name | Ports | Description |
|-----------|-------|-------------|
| `html:fetch` | `success \| cached \| error` | Fetches `state.page.url` via `HtmlScraper`. `cached` port fires on a cache hit. |
| `wiki:fetch` | `success \| error` | Fetches `state.page.title` via `MediaWikiScraper`. |
| `html:write-raw` | `success` | Writes raw HTML to `<outDir>/<taskName>/raw/<slug>.html`. |
| `wiki:write-raw` | `success` | Writes raw wikitext to `<outDir>/<taskName>/raw/<slug>.txt`. |
| `json:write` | `success \| skipped` | Writes `state.output` as JSON. `skipped` when `state.output` is null. |
| `jsonl:append` | `success \| skipped` | Appends `state.output` to a JSONL file. `skipped` when `state.output` is null. |
| `validate:schema` | `valid \| invalid` | Validates `state.output` against a JSON schema. |
| `crawl:init-frontier` | `ready \| empty` | Initializes the crawl frontier from the `crawler.startUrls` in state. |
| `crawl:fetch-and-extract` | `success \| empty \| error \| permanent` | Fetches a frontier page and extracts links. |
| `crawl:dedupe-and-enqueue` | `frontier-ready \| frontier-empty \| budget-exhausted` | Deduplicates extracted links, promotes the next frontier, checks `maxPages`. |
| `crawl:exhausted` | `success` | Terminal for the crawl loop — crawl:discover's exit point. |

Built-in node names follow the convention `namespace:verb`. `BUILTIN_PREFIXES` are `html:`, `wiki:`, `json:`, `jsonl:`, `validate:`, and `crawl:`.

## Built-in `crawl:discover` DAG

`crawl:discover` is a built-in cyclic DAG (loaded from `src/crawlers/crawl-discover.dag.jsonld`) registered by `PluginLoader.registerBuiltinNodes`. It implements level-by-level BFS with a native back-edge loop.

Embed it in any orchestration via `EmbeddedDAGNode`:

```json
{
  "@type": "EmbeddedDAGNode",
  "name":  "discover",
  "dag":   "crawl:discover",
  "stateMapping": {
    "output": { "urls": "crawl.discovered" }
  },
  "outputs": { "success": "next-step", "error": "crawl-failed" }
}
```

The `stateMapping.output` block seeds `state.urls` from `crawl.discovered` after the crawl completes. Configure the crawl behaviour via the `crawler` block in `state.json`. See [Crawler](/usage/crawler).

## Parallel parse

Route scatter items to a worker-thread pool with two changes:

1. Set `container: "worker"` on the `ScatterNode`.
2. Set `parallelWorkers: true` in `state.json`.
3. Build the worker registry: `npm run build:workers`.

The `WorkerThreadContainer` pool is sized by `NodeSystemInfo.recommendedWorkerCount`. When the worker registry is absent, the scatter falls back to in-process execution automatically.

## Plugin DAG registration order

Leaves (plugin DAGs with no external dependencies) register before dependents. `PluginLoader.pluginDagsInRegistrationOrder` topologically sorts the DAG documents found in `plugins/<namespace>/` so that an embedded DAG reference is always registered before the DAG that embeds it. The orchestration DAG is registered last.

## Related

- [Configuration](/usage/configuration): `state.json` field reference
- [Plugins](/usage/plugins): writing nodes and the `register` contract
- [Architecture](/architecture): DAG topology diagrams
