# Link-crawl as a native dagonizer loop

## Question

The wiki and html verticals now scrape via a framework-native `{ dag }`-body
scatter. The link-crawler does not: it drives recursive BFS frontier expansion
with a hand-rolled **trampoline** — `RecurseCrawlNode.executeOne` calls
`services.dispatcher.execute(LINK_CRAWL_LEVEL_DAG_NAME, clone)` at runtime, once
per depth level, merging the child run's accumulators back into the parent. This
is the only reason `LinkCrawlState.clone()` is load-bearing. Is recursive crawl a
dagonizer capability gap, or can it be expressed with the natives in
`@studnicky/dagonizer@0.23.0`?

## Finding

**It is not a gap.** A dagonizer DAG may contain a **back-edge** — a node output
route that targets an already-executed placement — and the engine **re-executes**
the target in place, on the same state, until items reach a terminal. BFS crawl is
therefore expressible as a single static **cyclic DAG** with no trampoline, no
level DAG, and no `clone()`. The trampoline is a pre-native workaround.

The retry machinery on `NodeStateBase` (`recordAttempt` / `withinRetryBudget`)
already documents this as the intended shape: *"Retry is a flow shape: the count
lives in state, the loop edge lives in the DAG … the same node on a self-loop."*
A bounded retry loop and a bounded BFS loop are the same construct — a back-edge
guarded by a state-held budget.

## Evidence

Every layer of the engine permits and honors back-edges; none rejects or dedupes
them. Paths are under `node_modules/@studnicky/dagonizer/dist`.

1. **Semantic validator does not reject cycles.** `validation/DAGValidator.js`
   (`validateDAGConfig`) checks only duplicate names, entrypoint existence, and
   that route targets / sub-DAG references resolve. There is no cycle detection
   for intra-DAG routing. (Its comment that "the reference graph is necessarily
   acyclic" is scoped to *sub-DAG* references — `EmbeddedDAGNode`/`ScatterNode`
   bodies — not to node-to-node `outputs` routes.)

2. **Rank computation tolerates back-edges.** `core/PlacementRank.js` computes a
   topological rank via DFS and explicitly excludes back-edges "including
   self-loops" from the predecessor walk so it terminates on cycles, returning a
   finite rank rather than erroring.

3. **The scheduler re-queues whatever a route names — no visited-guard.**
   `execution/NodeScheduler.js` `#fireSinglePlacement` applies every output port:
   ```js
   for (const [outputPort, subBatch] of routed.entries()) {
     const nextPlacement = nodeConfig.outputs[outputPort];
     pending.add(nextPlacement, subBatch);   // back-edge target re-added here
   }
   ```
   The main loop then picks the next ready placement by rank
   (`pending.nextReady(rankOf, declIndexOf)`). A back-edge target has lower rank
   than the node that routed to it, so it is selected next and fires again.

4. **The work set re-adds without dedup.** `core/WorkSet.js` `add(node, batch)`
   concatenates onto any existing batch for that placement and is otherwise an
   unconditional `Map.set`. There is no "already executed" exclusion. `executedNodes`
   is an append-only audit list; duplicates are expected.

State threads through the loop in place (size-1 batch path: the same state row is
carried on each `pending.add`), so iterations accumulate on one object — exactly
what the trampoline simulates today by cloning and merging.

## Current architecture (the trampoline)

- `src/state/LinkCrawlState.ts` — `frontier` (current level), `nextFrontierRaw` /
  `discoveredRaw` (per-level fan-in accumulators), `discovered` / `visited`
  (cross-level accumulators), `depth`, `maxDepth`, `maxPages`. `clone()` deep-copies
  every array so a child run's mutations don't leak.
- `src/nodes/crawl/` — `InitFrontierNode` (seed), `FetchAndExtractLinksNode`
  (batch-fetch the whole frontier, append discovered + next-frontier links, update
  `visited`), `DedupeAndEnqueueNode` (promote `discoveredRaw`→`discovered`, dedupe
  `nextFrontierRaw` vs `visited` into the next `frontier`, advance `depth`, apply
  the depth/budget guard), `RecurseCrawlNode` (the trampoline), `CrawlExhaustedNode`
  (final dedup/sort/cap).
- `src/flows/linkCrawlFlow.ts` — `buildLinkCrawlFlow()` returns **two** DAGs:
  `linkCrawlDAG` (outer: `init → fetch → dedupe → {recurse | exhausted} → completed`)
  and `linkCrawlLevelDAG` (the same minus `init`, dispatched per level by
  `RecurseCrawlNode`). Both are acyclic; recursion lives in node code, not the graph.
- `RecurseCrawlNode.executeOne`: clones state (to get a fresh `pending` lifecycle —
  `dispatcher.execute` would `markRunning()` on an already-`running` state and
  throw), dispatches `linkCrawlLevelDAG` against the clone, then copies
  `discovered` / `visited` / `depth` / `frontier` / `discoveredRaw` /
  `nextFrontierRaw` back. The clone-and-merge is the sole consumer of
  `LinkCrawlState.clone()`.

The cost of the workaround: a second registered DAG, the clone/merge boilerplate,
the load-bearing `clone()` override, and an extra `dispatcher.execute` per depth
level (its own observer/lifecycle overhead).

## Native redesign — one cyclic DAG

Replace the back-edge that today points at `crawl:recurse` with a back-edge that
points at the frontier processor:

```
crawl:init-frontier ──ready──▶ crawl:fetch-and-extract
                    └─empty──▶ crawl:exhausted
crawl:fetch-and-extract ─(success|empty|error|permanent)─▶ crawl:dedupe-and-enqueue
crawl:dedupe-and-enqueue
        ├─frontier-ready────▶ crawl:fetch-and-extract     ◀── BACK-EDGE (the loop)
        ├─frontier-empty────▶ crawl:exhausted
        └─budget-exhausted──▶ crawl:exhausted
crawl:exhausted ──success──▶ crawl:completed (terminal)
```

`crawl:dedupe-and-enqueue`'s existing depth/budget computation **is** the loop
guard — identical role to `withinRetryBudget` in a retry self-loop. Each
`frontier-ready` re-fires `crawl:fetch-and-extract` on the same, in-place-mutated
state; `frontier-empty` / `budget-exhausted` exits to the terminal.

Deleted by this change:
- `RecurseCrawlNode` and the `crawl:recurse` placement.
- `linkCrawlLevelDAG` (the second DAG) — one DAG remains.
- `LinkCrawlState.clone()` — no longer load-bearing (the loop never re-dispatches),
  so it falls back to the base metadata-only clone, mirroring the `ScrapeState`
  clone drop from the `{ dag }`-scatter rework.
- The clone-and-merge block and the stale "DeepDAGNode" framing in `registerAllFlows`.

Behavioral parity to verify: identical `discovered` / `visited` sets and ordering,
identical depth/budget termination, on a fixed fixture crawl vs. the trampoline
baseline.

### Optional enhancement — per-level parallelism

`FetchAndExtractLinksNode` fetches the whole frontier in one node body
(sequential within the level). The loop body can instead be a **scatter over
`state.frontier`** (fan out per-URL fetch + extract, gather discovered links into
`nextFrontierRaw`), still inside the same back-edge loop. This is the wiki/html
`{ dag }`/node-scatter pattern applied per level, and gives true per-page
concurrency on the fetch. It composes with the cyclic-DAG redesign and is
independent of it.

## What is genuinely not native today

Three adjacent shapes are *not* available in 0.23 — none blocks the redesign
above, but they bound how far the model goes:

1. **Streaming scatter over a growing frontier (single unbounded scatter).**
   `execution/ScatterSource.js` normalizes an `AsyncIterable` source, so a scatter
   *can* pull from a live producer. But `ScatterSource.toAsyncIterator(source)` is
   evaluated **once at scatter entry**; if the source is a plain `state.frontier`
   array, later appends are invisible to that scatter. Feeding a growing frontier
   into a *single* scatter requires a live async generator backed by a queue the
   loop body pushes to — workable, but bespoke. The declarative form would be the
   `reservoir` option, which is **schema-accepted but documented "no runtime effect
   yet"** (`builder/DAGBuilder.d.ts`; `execution/ReservoirBuffer.js` implements the
   buffering but is not yet wired into `ScatterExecutor`). The per-level loop
   (above) sidesteps this entirely by re-scattering a bounded frontier each
   iteration. **Dagonizer ask:** land reservoir runtime + a documented "live
   source" contract if a single-scatter streaming crawl is ever wanted.

2. **Self-referential / mutually-recursive `embeddedDAG`.** A DAG cannot embed
   itself (or form an A→B→A sub-DAG cycle): `registerDAG` validates that an
   embedded body references an **already-registered** DAG, and a DAG is not in the
   registry during its own registration (`DAGValidator` "backward-only" comment;
   the `unknown registered DAG` gate). Recursion-by-embedding is thus impossible,
   and `execution/EmbeddedDagExecutor.js` has no depth guard. The back-edge loop
   makes this unnecessary for crawl. **Dagonizer ask (only if embedded recursion
   is desired elsewhere):** allow forward/self sub-DAG references plus a
   recursion-depth ceiling.

3. **No first-class `loop`/`while`/`until` placement.** There is no declarative
   iteration construct; looping is expressed as a back-edge guarded by state. This
   is sufficient (it is how retry works) but implicit — the loop and its bound are
   spread across a route map and a node's branching logic rather than named. **Optional
   dagonizer ask:** a `.loop(body, { until })` builder sugar over the back-edge +
   guard, for readability and visualization.

## Recommendation

Adopt the native cyclic-DAG crawl (delete `RecurseCrawlNode`, the level DAG, and
the `LinkCrawlState.clone()` override). It removes a whole registered DAG, the
clone/merge boilerplate, and the last load-bearing `clone()` in the codebase, and
finishes the "native dagonizer over ripper-side reinvention" direction the
migration set. The per-level scatter is a natural follow-on for fetch concurrency.
The three non-native shapes above are not required for crawl; only reservoir
runtime would matter, and only if a single-scatter streaming model is later
preferred over the bounded per-level loop.

**Status: implemented.** The cyclic-DAG crawl shipped — `buildLinkCrawlFlow()`
returns the single cyclic `linkCrawlDAG` with the `frontier-ready` back-edge;
`RecurseCrawlNode`, `linkCrawlLevelDAG`, and `LinkCrawlState.clone()` are deleted.
`LinkLister` tests cover multi-level parity and termination (natural exhaustion
and a `maxPages` mid-loop cap). The per-level scatter for fetch concurrency
remains an optional follow-on.
