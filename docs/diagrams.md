# DAG Diagrams

Every Ripperoni run is an authored dagonizer DAG. These diagrams are generated
directly from the committed `*.dag.jsonld` documents and plugin DAGs by
`docs/.vitepress/scripts/render-dags.mjs` (via the framework's `MermaidRenderer`),
so they always reflect exactly what `ripperoni run` dispatches.

These node shapes are the same across every diagram (the renderer assigns one
shape per placement type):

| Shape | Placement | Meaning |
|---|---|---|
| `[ name ]` rectangle | **SingleNode** | one node runs once |
| `[/ name /]` trapezoid | **ScatterNode** | fan-out — one child run per source item |
| `[[ name ]]` subroutine | **EmbeddedDAGNode** | invokes a nested DAG |
| `(( name ))` double circle | **Terminal** (completed) | successful end state |
| `> name ]` flag | **Terminal** (failed) | failure end state |
| `( name )` stadium | **PhaseNode** | a pre/post lifecycle hook |

Placements bound to a worker container are tinted **blue**.

Hover a diagram for its **D-pad** (zoom · pan · centre · fit), scroll to zoom,
drag to pan, or hit **⛶ expand** for a fullscreen explore view (`esc` to close).

## Orchestration — `aonprd:crawl`

The top-level run: embed `crawl:discover` to populate the URL list, then scatter
the per-page DAG `aonprd:page` over it on the worker container.

```mermaid
<!--@include: ./_generated/aonprdCrawlDAG.mmd -->
```

## Link discovery — `crawl:discover`

The native cyclic crawl: `init-frontier → fetch-and-extract → dedupe-and-enqueue`
with a back-edge that loops until the frontier is exhausted or the budget is hit.

```mermaid
<!--@include: ./_generated/crawlDiscoverDAG.mmd -->
```

## Per-page chain — `aonprd:page`

The unit of work for one detail page: fetch HTML, parse via the embedded
`aonprd:parse` sub-DAG, write JSON.

```mermaid
<!--@include: ./_generated/aonprdPageDAG.mmd -->
```

## Example: docs scraper — `docs:parse`

```mermaid
<!--@include: ./_generated/docsScraperDAG.mmd -->
```

## Example: wiki docs — `wiki-docs:parse`

```mermaid
<!--@include: ./_generated/wikiDocsDAG.mmd -->
```

## Full parse taxonomy — `aonprd:parse`

The complete AONPRD parse DAG — every concept's capability chain compiled from the
taxonomy (191 placements). Large by design; zoom or pan to explore.

```mermaid
<!--@include: ./_generated/aonprdParseDAG.mmd -->
```

## D&D 5e parse taxonomy — `dnd5e:parse`

The D&D 5e parse DAG compiled from the shared taxonomy compiler (`src/taxonomy/`).
Content-classified: `dnd5e:taxonomy-route` inspects the page body to dispatch to
the matching concept chain; unrecognised pages route to `dnd5e:unknown-end`.

```mermaid
<!--@include: ./_generated/dnd5eParseDAG.mmd -->
```
