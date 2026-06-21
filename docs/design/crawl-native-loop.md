# Link-crawl as a native dagonizer loop

## Question

The wiki and html verticals now scrape via a framework-native `{ dag }`-body
scatter. The link-crawler did not: it drove recursive BFS frontier expansion
with a hand-rolled **trampoline** — `RecurseCrawlNode.executeOne` called
`services.dispatcher.execute(LINK_CRAWL_LEVEL_DAG_NAME, clone)` at runtime, once
per depth level, merging the child run's accumulators back into the parent. This
was the only reason `LinkCrawlState.clone()` was load-bearing. Was recursive crawl a
dagonizer capability gap, or could it be expressed with the natives in
`@studnicky/dagonizer@0.24`?

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

Every layer of `@studnicky/dagonizer@0.24` permits and honors back-edges; none
rejects or dedupes them. Paths are under `node_modules/@studnicky/dagonizer/dist`.

1. **Semantic validator does not reject cycles.** `validation/DAGValidator.js`
   (`validateDAGConfig`) checks only duplicate names, entrypoint existence, and
   that route targets / embedded DAG references resolve. There is no cycle detection
   for intra-DAG routing. (Its comment that "the reference graph is necessarily
   acyclic" is scoped to *embedded DAG* references — `EmbeddedDAGNode`/`ScatterNode`
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
what the trampoline simulated by cloning and merging.

## Prior architecture (the trampoline)

Before the native redesign, the link crawler drove BFS with a hand-rolled
trampoline. This section records what it looked like and why the redesign was
motivated — all of the following has since been removed.

- `src/state/LinkCrawlState.ts` — held `frontier`, `nextFrontierRaw` /
  `discoveredRaw` (per-level fan-in accumulators), `discovered` / `visited`
  (cross-level accumulators), `depth`, `maxDepth`, `maxPages`. `clone()` deep-copied
  every array so a child run's mutations wouldn't leak.
- `src/nodes/crawl/` — `InitFrontierNode`, `FetchAndExtractLinksNode`,
  `DedupeAndEnqueueNode`, `RecurseCrawlNode` (the trampoline), `CrawlExhaustedNode`.
- `src/flows/linkCrawlFlow.ts` — `buildLinkCrawlFlow()` returned **two** DAGs:
  `linkCrawlDAG` (outer: `init → fetch → dedupe → {recurse | exhausted} → completed`)
  and `linkCrawlLevelDAG` (the same minus `init`, dispatched per level by
  `RecurseCrawlNode`). Both were acyclic; recursion lived in node code, not the graph.
- `RecurseCrawlNode.executeOne` cloned state (to get a fresh `pending` lifecycle —
  `dispatcher.execute` would `markRunning()` on an already-`running` state and
  throw), dispatched `linkCrawlLevelDAG` against the clone, then copied
  `discovered` / `visited` / `depth` / `frontier` / `discoveredRaw` /
  `nextFrontierRaw` back. The clone-and-merge was the sole consumer of
  `LinkCrawlState.clone()`.

The cost of the workaround: a second registered DAG, the clone/merge boilerplate,
the load-bearing `clone()` override, and an extra `dispatcher.execute` per depth
level (its own observer/lifecycle overhead).

## Native redesign — one cyclic DAG

The redesign replaced the back-edge that previously pointed at `crawl:recurse`
with a back-edge that points at the frontier processor directly:

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

Deleted by this change (all confirmed removed):
- `RecurseCrawlNode` and the `crawl:recurse` placement.
- `linkCrawlLevelDAG` (the second DAG) — one DAG remains.
- `LinkCrawlState.clone()` — no longer load-bearing (the loop never re-dispatches);
  the base metadata-only clone from `NodeStateBase` is sufficient, mirroring the
  `ScrapeState` clone drop from the `{ dag }`-scatter rework.
- The clone-and-merge block in `registerAllFlows`.

Behavioral parity was verified: identical `discovered` / `visited` sets and ordering,
identical depth/budget termination, validated against a fixed fixture crawl vs. the
trampoline baseline (`LinkLister` tests cover multi-level parity and natural
exhaustion and `maxPages` mid-loop cap).

### Optional enhancement — per-level parallelism

`FetchAndExtractLinksNode` fetches the whole frontier in one node body
(sequential within the level). The loop body can instead be a **scatter over
`state.frontier`** (fan out per-URL fetch + extract, gather discovered links into
`nextFrontierRaw`), still inside the same back-edge loop. This is the wiki/html
`{ dag }`/node-scatter pattern applied per level, and gives true per-page
concurrency on the fetch. It composes with the cyclic-DAG redesign and is
independent of it.

## What is genuinely not native today

Three adjacent shapes are *not* available in 0.24 — none blocked the redesign
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
   itself (or form an A→B→A embedded DAG cycle): `registerDAG` validates that an
   embedded body references an **already-registered** DAG, and a DAG is not in the
   registry during its own registration (`DAGValidator` "backward-only" comment;
   the `unknown registered DAG` gate). Recursion-by-embedding is thus impossible,
   and `execution/EmbeddedDagExecutor.js` has no depth guard. The back-edge loop
   makes this unnecessary for crawl. **Dagonizer ask (only if embedded recursion
   is desired elsewhere):** allow forward/self embedded DAG references plus a
   recursion-depth ceiling.

3. **No first-class `loop`/`while`/`until` placement.** There is no declarative
   iteration construct; looping is expressed as a back-edge guarded by state. This
   is sufficient (it is how retry works) but implicit — the loop and its bound are
   spread across a route map and a node's branching logic rather than named. **Optional
   dagonizer ask:** a `.loop(body, { until })` builder sugar over the back-edge +
   guard, for readability and visualization.

## Outcome

The native cyclic-DAG crawl is implemented. `buildLinkCrawlFlow()` returns the
single cyclic `linkCrawlDAG` with the `frontier-ready` back-edge; `RecurseCrawlNode`,
`linkCrawlLevelDAG`, and `LinkCrawlState.clone()` are deleted. This removes a whole
registered DAG, the clone/merge boilerplate, and the last load-bearing `clone()` in
the codebase, completing the "native dagonizer over ripper-side reinvention" direction
the migration set. `LinkLister` tests cover multi-level parity and termination (natural
exhaustion and a `maxPages` mid-loop cap). The per-level scatter for fetch concurrency
remains an optional follow-on. The three non-native shapes identified in the analysis
are not required for crawl; only reservoir runtime would matter if a single-scatter
streaming model were later preferred over the bounded per-level loop.
