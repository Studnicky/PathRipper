# Roadmap

This roadmap tracks what is shipped and what is planned. The scrape engine runs on [@studnicky/dagonizer](https://github.com/Studnicky/Dagonizer), a typed DAG execution runtime — all orchestrations are authored as committed `.dag.jsonld` documents loaded by the framework's own `DAGDocument.load`.

## Shipped (v4.x — native DAG model)

| Feature | Status | Details |
|---------|--------|---------|
| Native DAG-document orchestration | live | A scrape run is `ripperoni run <dag.jsonld> --state <state.json>`. The orchestration is one committed `.dag.jsonld` document loaded via `DAGDocument.load`. No runtime DAG compilation, no config-json pipeline array. |
| `ripperoni scaffold` | live | Writes a starter `<name>.dag.jsonld` + `<name>.state.json` pair from committed example templates. |
| Plugin DAG-document contract | live | Plugins ship `*.dag.jsonld` files in `plugins/<namespace>/`. `PluginLoader.registerPluginsFromEntry` discovers namespaces from the orchestration's placements, loads every `*.dag.jsonld`, and calls `register(dispatcher)` (node instances only). |
| `crawl:discover` builtin DAG | live | Cyclic BFS embedded DAG (`src/crawlers/crawl-discover.dag.jsonld`) for link discovery. Embedded in an orchestration via `EmbeddedDAGNode { dag: "crawl:discover" }`. Configured via the `crawler` block in `state.json`. |
| Parallel parse via worker container | live | `parallelWorkers: true` in `state.json` binds a `WorkerThreadContainer` (from `@studnicky/dagonizer-executor-node`) to the "worker" role. `ScatterNode` placements with `container: "worker"` route to the pool, sized by `NodeSystemInfo.recommendedWorkerCount`. Build with `npm run build:workers`. Falls back in-process when absent. |
| `RunStateSchema` | live | AJV schema validating `state.json`: `baseUrl`, `apiUrl`, `cache`, `output`, `headers`, `crawler`, `urls`, `parallelWorkers`, `includeRawContent`, `outputSchema`, `onSchemaError`. |
| `PluginLoader` | live | Static class: `registerBuiltinNodes` (all builtin nodes + `crawl:discover` DAG), `registerPluginsFromEntry` (namespace discovery + plugin DAG loading), `derivePluginTaskName`, `pluginDagsInRegistrationOrder`. |

## Shipped (v3.x)

| Feature | Status | Details |
|---------|--------|---------|
| Dagonizer (foundation) | live | Core engine on `@studnicky/dagonizer@0.24.0` (GitHub Packages). Nodes use the batch contract (`ScalarNode` + `executeOne`). DAGs authored with native `DAGBuilder` (`.node`/`.scatter`/`.embeddedDAG`/`.terminal`). |
| Worker-thread parse (html) | live | CPU-bound per-page parse in a `WorkerThreadContainer` pool, sized to the machine; fetch and write stay coordinator-side. |
| Contract eslint rules | live | `eslint-rules/noocodec.mjs` enforces `interface-must-be-contract`, `logger-binding-name`, and `group-types-in-namespace`. |
| Explicit plugin registration | live | Plugins export `register(dispatcher: RipperDagonizer<ScrapeState>): void`. |
| `RipperServices` | live | Services bag interface (`src/services/RipperServices.ts`) injected via the proxy-services pattern. |
| Taxonomic extractor (AONPRD plugin) | live | AONPRD plugin covers 51 concepts. URL-routing DAG dispatches to per-concept embedded DAGs at parse time. |
| Concept identity via URL | live | Concept identity carried by the URL (e.g. `Feats.aspx`) and typed `<concept>_id` fields on the record. |
| Resilience layer | live | `FailurePolicy`-routed failures (`retry \| resolve \| capture \| expected`), error-as-data capture (`error:capture` writes `{ _type: 'error' }` docs via `json:write`), post-crawl identity reconciliation (`reconcile:identity` + `ReconcilerInterface`), `crawl-health.json` reporting, and opt-in wrong-locator link resolution (`resolve:link` + `LinkResolverRegistry`). |

## Shipped (v2.x)

Foundation layer: scraper primitives, HTTP machinery, and caching.

| Feature | Status | Details |
|---------|--------|---------|
| Strict TypeScript | live | Full strict TypeScript. `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, flat ESLint config. |
| HTML scraper | live | Native `fetch` + `cheerio`. Configurable base URL, headers, rate limit. Returns a live `CheerioAPI` handle. |
| MediaWiki scraper | live | Native `fetch()` to the MediaWiki JSON API. Category listing with full pagination, 50-page batch wikitext fetches, `wtf_wikipedia` infobox parsing. |
| Link crawler (native cyclic DAG) | live | BFS frontier expansion runs as the native cyclic `crawl:discover` DAG — `crawl:dedupe-and-enqueue` routes `frontier-ready` back to `crawl:fetch-and-extract` (a back-edge the engine re-executes), guarded by the depth/budget check. Design in `docs/design/crawl-native-loop.md`. |
| HTTP machinery | live | `ErrorClassifier` + `HttpRetryPolicy`. `RateLimiter` wrapping `bottleneck`. `Retry-After` header respected. Seven error categories. Decorrelated-jitter backoff. |
| Structured logger | live | `Logger.forComponent(name)`, JSON lines, `LOG_LEVEL` gate, component + operation attribution. |
| Checkpoint + resume | live | Already-written slugs detected at run start and skipped. Failed pages written to `failures.json`; re-run with `urls: [...]` in state.json to retry only those. |
| Cache | live | Content-addressed per-target HTML cache; `read-write`/`read-only`/`write-only`/`off` modes with TTL. |

## Planned

| Feature | Details |
|---------|---------|
| Per-level crawl concurrency | Scatter the cyclic crawl's per-level frontier fetch so pages at one depth level fetch concurrently, still inside the native back-edge loop. |
| Worker parsing for the wiki vertical | Extend worker-thread parse to the MediaWiki path so per-page wiki parse runs in the system-sized pool. |
| Streaming/reservoir scatter | Reservoir-fed scatter over an unbounded `AsyncIterable` frontier for very large target lists, once the throughput need is proven. |
| JSDOM fallback mode | Configurable `jsdom` mode in `HtmlScraper` for JS-rendered pages without a full headless browser. |
| HTML to Markdown conversion | Output mode that converts scraped HTML to clean Markdown for LLM pipeline ingestion. |
