# Roadmap

This roadmap tracks what is shipped and what is planned. The scrape engine runs on [@studnicky/dagonizer](https://github.com/Studnicky/Dagonizer), a typed DAG execution runtime — all orchestrations are authored as committed `.dag.jsonld` documents loaded by the framework's own `DAGDocument.load`.

## Shipped (v3.3.x)

| Feature | Status | Details |
|---------|--------|---------|
| Streaming/reservoir scatter | live | `ScatterNode` accepts a `reservoir: { keyField, capacity, idleMs }` block in the orchestration DAG. The engine processes only `capacity` items concurrently, releasing a slot as each item completes — bounding active-clone memory regardless of source-array size. `ripperoni.example.dag.jsonld` ships `reservoir: { keyField: "currentItem", capacity: 50, idleMs: 30000 }` as the default. `RunStateSchema` gains a `reservoir` block for documenting intent alongside the DAG. |
| HTML to Markdown conversion | live | `markdown:write` node converts `state.page.html` to clean GFM Markdown and writes `<slug>.md` alongside JSON output. `MarkdownConverter` uses Cheerio for DOM traversal — handles headings, paragraphs, links, bold/italic, code blocks, lists, blockquotes, GFM tables, and images. Relative URLs are resolved against `state.page.url`. |
| Per-level crawl concurrency | live | `crawler.concurrency` in `state.json` sets the maximum number of pages fetched concurrently within a single BFS depth level. Passed as `maxConcurrent` to the Bottleneck rate limiter; `FetchAndExtractLinksNode` uses `Promise.allSettled` to launch all frontier fetches concurrently and merges results. Defaults to `1` (sequential) when absent. |
| JSDOM fallback mode | live | `useJsdom: true` in `state.json` routes `HtmlScraper.fetchPage` through JSDOM after fetching: HTML is parsed with `runScripts: 'dangerously'` and serialized back before cheerio parsing. `state.page.html` and the `$` API are unchanged. No subresources are fetched (JSDOM default); page-script errors from unloaded globals are swallowed via a bare `VirtualConsole`. Load-event ceiling is `jsdomLoadTimeoutMs ?? max(10_000, retryMaxDelayMs ?? 30_000)` ms — a 10 s floor that scales with the target's retry tolerance. The timer clears as soon as the `load` event fires. |
| Worker wiki vertical | live | `ParseRegistryModule` now rebuilds `MediaWikiScraper` inside each worker isolate when `apiUrl` is present in the services config. Wiki plugin authors can now declare `container: "worker"` on scatter placements that call `wiki:fetch`. |
| Shared taxonomy compiler | live | `src/taxonomy/` is plugin-agnostic shared infrastructure that any source plugin compiles against. `Taxonomy.compile(concepts, options)` (where `options: { namespace, pathExtractor }`) produces per-concept capability chains, `routeUrl`, `chainFor`, `allNodes`, and `buildDAG`. Router helpers `makeTaxonomyRouter` and `makeConceptDispatch` live in `TaxonomyRouterNodes.ts`; extraction strategy interfaces in `ExtractionStrategy.ts`. Node names are namespaced (`<namespace>:taxonomy-route`, `<namespace>:concept-dispatch`). Both `aonprd` and `dnd5e` compile their taxonomy from this one module. |
| D&D 5e structured-parse plugin | live | `plugins/dnd5e/` parses dandwiki.com 5e SRD pages into typed JSON, built on the shared taxonomy compiler. Because dandwiki URLs do not encode the concept type (unlike AONPRD's `.aspx` paths), the plugin classifies each page by content — spell table presence, breadcrumb category, italic type line. Typed concept: `spell` (`level`, `school`, `casting_time`, `range`, `components`, `duration`, `higher_levels`, `description_text`, `source`, `category`, `links`) with a `generic` fallback for unrecognised concepts. Direct-call API: `parseDnd5eHtml(html, url)`. The `dnd5e:parse` DAG is built from the taxonomy. |

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
| Streaming frontier source | Reservoir-fed scatter over an unbounded streaming frontier for very large target lists. The engine support is already present — dagonizer's `ScatterSource` normalizes an array, a sync `Iterable`, or an `AsyncIterable`, and the shipped `reservoir` block bounds active-clone memory. The remaining work is ripperoni-side: a streaming discovery source that yields URLs as an `AsyncIterable` into the reservoir scatter. Today `crawl:discover` materializes the full frontier into `state.urls` (a finite array) before the scatter runs, so a very large crawl holds every discovered URL in memory at once. |
