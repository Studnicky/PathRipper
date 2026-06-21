# Roadmap

This roadmap tracks what is shipped and what is planned. The scrape engine runs on [@studnicky/dagonizer](https://github.com/Studnicky/Dagonizer), a typed DAG execution runtime — all pipeline flows are built with its native builder API.

## Shipped (v3.x)

Every feature in this section is live.

| Feature | Status | Details |
|---------|--------|---------|
| Dagonizer (foundation) | live | The core engine. Runs on `@studnicky/dagonizer@0.24.0` (GitHub Packages). Nodes use the batch contract (`ScalarNode` + `executeOne`). All flows are built with native `DAGBuilder` (`.node`/`.scatter`/`.embeddedDAG`/`.terminal`) — `configLoadFlow` uses explicit `.node()`/`.terminal()` placements with exhaustive route maps; the aonprd parse DAG is produced by `Taxonomy.buildDAG()`. Routing reads off `RoutedBatchType` (`result.has(port)`). Per-page wiki/html scrape dispatches via a native `{ dag: perPageDag }` scatter body (`itemKey` metadata → `WikiFetchNode`/`HtmlFetchNode` initialise `state.page`); `ScrapeState` uses the base metadata-only clone. |
| `RipperRun` composition root | live | `runHtml(opts)` and `runWiki(opts)` in `src/run/` are the composition roots for all scrape runs. The CLI invokes them via `DispatchHtmlScrapeNode` / `DispatchWikiScrapeNode`. |
| Worker-thread parse (html) | live | The CPU-bound per-page plugin parse runs in a `WorkerThreadContainer` pool (default on via `enableWorkers`), sized to the machine by `NodeSystemInfo.recommendedWorkerCount` (cores − main thread); the per-page scatter concurrency matches the pool. Fetch + write stay coordinator-side. The plugin-agnostic worker registry rebuilds the parse DAG via the shared `PluginLoader`; the worker closure compiles to a self-contained `dist-workers/` (`npm run build:workers`). Falls back to in-process when that tree is absent. |
| Contract eslint rules | live | `eslint-rules/noocodec.mjs` enforces `interface-must-be-contract`, `logger-binding-name`, and `group-types-in-namespace` (exempting `src/types/`) at `error`. Data-shape interfaces are `type` aliases with the `*Type` suffix; logger bindings are `log`. |
| Explicit plugin registration | live | Plugins export `register(dispatcher: RipperDagonizer<ScrapeState>): void`. The runner imports each plugin module and calls `register(dispatcher)` explicitly. |
| `RipperServices` | live | Services bag interface is `RipperServices` (`src/services/RipperServices.ts`). Constructed as a plain object literal and injected via the proxy-services pattern. |
| Taxonomic extractor (AONPRD plugin) | live | The AONPRD plugin covers 51 concepts. Each concept declares URL path patterns and capability nodes. A URL-routing DAG dispatches to the correct concept's embedded DAG at parse time. |
| Concept identity via URL | live | Concept identity is carried by the URL (e.g. `Feats.aspx`) and typed `<concept>_id` fields on the record. No discriminator property on output shapes. |

## Shipped (v2.x)

Foundation layer: the scraper primitives, HTTP machinery, and config system.

| Feature | Status | Details |
|---------|--------|---------|
| Strict TypeScript | live | Full strict TypeScript. `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, flat ESLint config. |
| HTML scraper | live | Native `fetch` + `cheerio`. Configurable base URL, headers, rate limit. Returns a live `CheerioAPI` handle. |
| MediaWiki scraper | live | Native `fetch()` to the MediaWiki JSON API. Category listing with full pagination, 50-page batch wikitext fetches, `wtf_wikipedia` infobox parsing. |
| LinkLister crawler | live | cheerio for link extraction. Numeric-aware sort. `Set`-based deduplication. BFS frontier expansion runs as a native cyclic DAG — `crawl:dedupe-and-enqueue` routes `frontier-ready` back to `crawl:fetch-and-extract` (a back-edge the engine re-executes), guarded by the depth/budget check. Design in `docs/design/crawl-native-loop.md`. |
| HTTP machinery | live | `ErrorClassifier` + `HttpRetryPolicy` (a `RetryPolicy` subclass consulting the classifier). `RateLimiter` wrapping `bottleneck`. `Retry-After` header respected. Seven error categories. Decorrelated-jitter backoff. |
| Structured logger | live | `Logger.forComponent(name)`, JSON lines, `LOG_LEVEL` gate, component + operation attribution on every entry. |
| JSON config | live | All targets, URLs, rate limits, and output paths live in `ripperoni.config.json`. Nothing hardcoded. `RipperConfig.load(path)` validates and returns a typed interface. |
| Config-driven plugin discovery | live | Plugins export `register(dispatcher: RipperDagonizer<ScrapeState>)`. `PluginLoader.registerInto` discovers them dynamically from `./plugins/<word>/<verb>.task.js` based on `pipeline: ["my-target:parse"]` config entries. |
| Checkpoint + resume | live | Already-written slugs are detected at run start and skipped. Failed pages are written to `failures.json`; pass `--resume-failures` to retry only those. |
| Config schema validation | live | AJV validates the config at load time. `RipperConfig.load(path)` throws with the exact field path on any violation; malformed configs fail fast and loudly. |

## Planned

| Feature | Details |
|---------|---------|
| Per-level crawl concurrency | Scatter the cyclic crawl's per-level frontier fetch (`crawl:fetch-and-extract`) so pages at one depth level fetch concurrently, still inside the native back-edge loop. |
| Worker parsing for the wiki vertical | Extend worker-thread parse (`enableWorkers`, `dist-workers/`) to `runWiki` so MediaWiki per-page parse runs in the system-sized pool alongside the html path. |
| Streaming/reservoir scatter | Reservoir-fed scatter over an unbounded `AsyncIterable` frontier for very large target lists, once the throughput need is proven. The scatter `reservoir` option is wired in dagonizer 0.24. |
| JSDOM fallback mode | Some pages require JavaScript execution to render their content. A configurable `jsdom` mode in `HtmlScraper` handles these without a full headless browser. |
| HTML → Markdown conversion | Output mode that converts scraped HTML to clean Markdown — useful for feeding scraped content into LLM pipelines. Likely via `turndown` or similar. |
