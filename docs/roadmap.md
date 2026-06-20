# Roadmap

## Shipped (v3.x)

| Feature | Status | Details |
|---------|--------|---------|
| Dagonizer | live | Runs on `@studnicky/dagonizer@0.23.0` (GitHub Packages). Nodes use the batch contract (`ScalarNode` + `executeOne`). Flows are built with native `DAGBuilder` (`.node`/`.scatter`/`.embeddedDAG`/`.terminal`); `configLoadFlow` and the aonprd `parse.dag` use `DAGDeriver.derive`. Routing is read off `RoutedBatchType` (`result.has(port)`). Per-page wiki/html scrape dispatches via a native `{ dag: perPageDag }` scatter body (`itemKey` metadata → `WikiFetchNode`/`HtmlFetchNode` initialise `state.page`); `ScrapeState` uses the base metadata-only clone. |
| `RipperRun` composition root | live | `runHtml(opts)` and `runWiki(opts)` in `src/run/` are the composition roots for all scrape runs. The CLI invokes them via `DispatchHtmlScrapeNode` / `DispatchWikiScrapeNode`. |
| Explicit plugin registration | live | Plugins export `register(dispatcher: RipperDagonizer<ScrapeState>): void`. The runner imports each plugin module and calls `register(dispatcher)` explicitly — no global registry. |
| `RipperServices` | live | Services bag interface is `RipperServices` (`src/services/RipperServices.ts`). Constructed as a plain object literal and injected via the proxy-services pattern. |
| Taxonomic extractor (AONPRD plugin) | live | The AONPRD plugin covers 51 concepts. Each concept declares URL path patterns and capability nodes. A URL-routing DAG dispatches to the correct concept sub-DAG at parse time. |
| Concept identity via URL | live | Concept identity is carried by the URL (e.g. `Feats.aspx`) and typed `<concept>_id` fields on the record. No discriminator property on output shapes. |

## Shipped (v2.x)

| Feature | Status | Details |
|---------|--------|---------|
| TypeScript rewrite | live | Full strict TypeScript from scratch. `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, flat ESLint config. |
| Pipeline (Transformer modernized) | live | PathRipper's callback-based `Transformer` becomes a typed `Pipeline<TState>`. Same middleware pattern, fully typed generic state. |
| HTML scraper | live | JSDOM replaced with native `fetch` + `cheerio`. Configurable base URL, headers, rate limit. Returns live `CheerioAPI` handle. |
| MediaWiki scraper | live | Native `fetch()` to the MediaWiki JSON API. Category listing with full pagination, 50-page batch wikitext fetches, `wtf_wikipedia` infobox parsing. |
| LinkLister crawler | live | PathRipper's recursive crawler rewritten. cheerio replaces JSDOM for link extraction. Concurrent traversals with `Promise.all`. Numeric-aware sort. `Set`-based deduplication. BFS frontier expansion is a single native cyclic DAG — `crawl:dedupe-and-enqueue` routes `frontier-ready` back to `crawl:fetch-and-extract` (a back-edge the engine re-executes), guarded by the depth/budget check. Design in `docs/design/crawl-native-loop.md`. |
| HTTP machinery | live | `ErrorClassifier` + `RetryExecutor` ported from TORUS. `RateLimiter` wrapping `bottleneck`. `Retry-After` header respected. Seven error categories. Exponential + jitter backoff. |
| Structured logger | live | Ported from Torreya's `@torreya/logger`. `Logger.forComponent(name)`, JSON lines, `LOG_LEVEL` gate, component + operation attribution on every entry. |
| JSON config | live | All targets, URLs, rate limits, and output paths live in `ripperoni.config.json`. Nothing hardcoded. `RipperConfig.load(path)` validates and returns a typed interface. |
| Concurrent pipeline | live | `ConcurrentPipeline.create(pipeline, concurrency)` fans N pages through the same pipeline simultaneously with a semaphore cap. |
| Plugin registration | live | Plugins export `register(dispatcher: RipperDagonizer<ScrapeState>)`. Loaded dynamically from `./plugins/<word>/<verb>.task.js` based on `pipeline: ["my-target:parse"]` config entries. |
| Checkpoint + resume | live | Already-written slugs are detected at run start and skipped. Failed pages are written to `failures.json`; pass `--resume-failures` to retry only those. |
| Config schema validation | live | AJV validates the config at load time. `RipperConfig.load(path)` throws with the exact field path on any violation; malformed configs fail fast and loudly. |

## Planned

| Feature | Details |
|---------|---------|
| Per-level crawl concurrency | Scatter the cyclic crawl's per-level frontier fetch (`crawl:fetch-and-extract`) so pages in one depth level fetch concurrently, still inside the native back-edge loop. Follow-on to the cyclic-DAG crawl now in place. |
| Worker-container parse execution | Run the CPU-bound per-page parse DAG in a worker pool via the scatter `container` option (honored only on `{ dag }` bodies — now in place). Requires adding `@studnicky/dagonizer-executor-node` and sizing by `SystemInfo.recommendedWorkerCount`. Streaming/reservoir-fed scatter for unbounded sources awaits dagonizer's reservoir runtime (schema-accepted, "no runtime effect yet"). |
| ESLint contract rules + interface→`Type` rename | Port `interface-must-be-contract`, `group-types-in-namespace`, `logger-binding-name` (from noocodec-bot) into `eslint.config.mjs` at `error`, then drive the resulting interface→`Type` rename + namespace grouping to zero (cascades through the `exports` map and tests). |
| JSDOM fallback mode | Some pages require JavaScript execution to render their content. A configurable `jsdom` mode in `HtmlScraper` would handle these without needing a full headless browser. |
| HTML → Markdown conversion | Output mode that converts scraped HTML to clean Markdown. Useful for feeding scraped content into LLM pipelines without sending raw HTML. Likely via `turndown` or similar. |
