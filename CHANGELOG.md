# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Shared taxonomy compiler (`src/taxonomy/`)** — the concept-taxonomy compiler, routing-node factories, and extraction-strategy interfaces are promoted to plugin-agnostic infrastructure, parameterized by `{ namespace, pathExtractor }`. `Taxonomy.compile(concepts, options)` builds the per-concept capability chains and the parse DAG for any plugin; `makeTaxonomyRouter`/`makeConceptDispatch`/`conceptIdKey` namespace the routing nodes. The `aonprd` plugin is migrated onto it in place (node names unchanged), so a second source plugin reuses one compiler with no duplication.
- **`plugins/dnd5e/` structured-parse plugin (dandwiki 5e SRD)** — a second source plugin on the shared taxonomy that emits typed JSON comparable to `aonprd`. Parses MediaWiki SRD pages, classifying each page by content (dandwiki URLs do not encode concept type) into a typed `spell` concept (`level`, `school`, `casting_time`, `range`, `components`, `duration`, `higher_levels`, `description_text`, `source`, `links`) or a `generic` fallback. Direct-call API `parseDnd5eHtml(html, url)`; the `dnd5e:parse` DAG is built from the taxonomy.

### Fixed

- **JSDOM scraper mode** — `HtmlScraper` JSDOM path passed the invalid `resources: 'none'` option (JSDOM accepts only `undefined`, `"usable"`, or a `ResourceLoader`), throwing on every `useJsdom: true` fetch. The option is omitted so the default (no subresource loading) applies; the load-event ceiling timer is now cleared on settle (was holding the event loop open for the full timeout); and a bare `VirtualConsole` suppresses page-script errors from unloaded globals (e.g. jQuery) instead of forwarding them to the host process.

## [3.2.1] - 2026-06-21

### Added

- **Resilience layer docs** — `docs/usage/resilience.md` documents the failure model (`route:failure`/`FailurePolicy`, `error:capture`, `reconcile:identity`/`report:crawl-health` + the `crawl-health.json` audit, opt-in `resolve:link`) and the plugin contracts; architecture and roadmap pages updated; sidebar entry added.

### Removed

- **Superseded dead code** — deleted the orphaned `plugins/aonprd/concepts/generic/{condition,hazard,trait}.ts` slices (freestanding extractors superseded by the dedicated `concepts/<x>/` `ScalarNode` concepts that produce the live output), the redundant `plugins/aonprd/page-raw.dag.ts` builder (the `aonprd:page-raw` capability runs from its `.dag.jsonld`), and the unused `vue` devDependency.

## [3.2.0] - 2026-06-21

### Added

- **`@studnicky/dagonizer` 0.25 adoption** — upgraded `@studnicky/dagonizer` and `@studnicky/dagonizer-executor-node` 0.24 → 0.25. Every `ScalarNode`/`MonadicNode` now declares the mandatory per-port `outputSchema` contract (a JSON Schema fragment describing the state delta each output port writes); manual `NodeContextType` literals move to `NodeContextBuilder.of(...)`; `DagContainerInterface` is no longer generic.
- **Resilience layer — failures are first-class, classified, recovered, and reported data.** A site-agnostic set of builtin nodes composed from native dagonizer primitives (retry budget, error ports, embedded sub-DAGs), configured per target:
  - **`FailurePolicy` + `route:failure`** — `html:fetch` stashes a structured failure context and the `route:failure` node consults a pluggable `FailurePolicy` to route `retry | resolve | capture | expected`. The default policy retries *transient* errors (5xx/429/network) on a bounded self-loop via the native `recordAttempt` budget and captures *permanent* 4xx (404) immediately — no wasted requests. Sits above the per-request `HttpRetryPolicy` as a coarser, flow-visible layer.
  - **`error:capture`** — projects the `NodeError`s on `state.errors` into `state.output` as an `{ _type: 'error', url, errors }` document that `json:write` persists, so a failing page is inspectable data on disk instead of vanishing into an opaque scatter error partition (otherwise unrecoverable across the worker boundary).
  - **`reconcile:identity` + `report:crawl-health`** — post-crawl nodes that build an identity index from captured concepts via a fully pluggable `Reconciler` (`prepare(concepts) → index`, `resolveFailure(failure, index)`), reclassify each failure as `capturedElsewhere | missing | dead`, and write a `crawl-health.json` audit manifest (totals + `missing[]` + `capturedElsewhere[]`). The AON reconciler matches a broken cross-category link by its preserved id + originating link text, resolving e.g. the mislinked `Classes.aspx?ID=77` "catfolk" to the captured `Ancestries.aspx?ID=77` ancestry — proving data completeness automatically at scale.
  - **`resolve:link`** (opt-in) — on `route:failure → resolve`, ordered `LinkResolverStrategy` implementations (`crossLocator` probes sibling categories for the same id; `search`; `canonical`) recover a wrong-locator link and re-fetch the corrected url, bounded by a resolve budget. Dormant unless a target supplies `services.resolve`.
- **CodeQL static analysis** — `.github/workflows/codeql.yml` runs the `security-extended` query suite over the TypeScript sources on every push/PR to the protected branches and weekly, surfacing findings under Security > Code scanning.

### Fixed

- **Worker-thread DAG assets** — `scripts/copy-dag-assets.mjs` now mirrors `.dag.jsonld` documents into `dist-workers/` (both the `src/` builtins and the `plugins/` documents), not only `dist/`. Without them a `WorkerThreadContainer` crashed on init (`DagHost init failed: ENOENT … crawl-discover.dag.jsonld`), so the parallel (`parallelWorkers: true`) scrape path produced no output. The parallel rip now fetches, parses, and writes correctly.

### Changed

- **Dependency refresh** — `@types/node` 25 → 26, `commander` 14 → 15, `typescript-eslint` 8.59 → 8.61.
- **Cleared all Dependabot alerts** — `overrides` pin `vite` to `^6.4.3` and `esbuild` to `^0.25.0`, replacing the vulnerable `vite@5`/`esbuild@0.21` that VitePress 1.6.4 pulls transitively. `npm audit` reports zero vulnerabilities; the docs build and dev server both verified on vite 6. These are dev-only (docs toolchain) dependencies and never shipped in `dist/`.

## [3.1.1] - 2026-06-21

### Changed

- **README condensed to a Dagonizer-style landing card** — `README.md` drops from 229 to 62 lines: a centered `og-image` banner linked to the docs site, a scoped `@studnicky/ripperoni` title with a one-line tagline, and a Documentation section linking the GitHub Pages sections that carry the detail. The outdated `pipeline`-list prose is replaced with the native two-document model (`scaffold` → `run`), the GitHub Packages install, and a CLI quick start.

## [3.1.0] - 2026-06-21

### Added

- **Published to GitHub Packages** as `@studnicky/ripperoni`. The package is scoped, public, and ships `dist/` + `dist-workers/`; `publish.yml` builds, validates, and publishes on a new version landing on master (idempotent via a version-already-published check), then cuts the GitHub release.
- **Social share banner** — `docs/public/og-image.svg` (1200×630, sausage logo + tagline) rendered to `og-image.png` via `scripts/render-og.mjs` (sharp), wired into `docs:build`. Fills the previously-missing `og:image` so unfurls on Discord / Slack / Twitter / LinkedIn show a branded card.

### Changed

- **Favicon is the Ripperoni (sausage) logo** — `favicon.svg` now embeds the logo and small PNG variants (32/48/180/192/512) are generated from it, replacing the placeholder "R". The web manifest gains an SVG icon entry and points at the logo favicons.

## [3.0.0] - 2026-06-21

### Added

- **`ripperoni run <dag.jsonld> --state <state.json>`** — the single command for executing a scrape run against a native dagonizer DAG document. Loads the orchestration via `DAGDocument.load`, validates state against `RunStateSchema`, builds services, discovers and registers plugins, and dispatches.
- **`ripperoni scaffold <name>`** — writes a starter `<name>.dag.jsonld` + `<name>.state.json` pair from the committed example templates.
- **Native DAG-document plugin contract** — plugins ship `*.dag.jsonld` documents in `plugins/<namespace>/` that the runner loads at startup via `PluginLoader.registerPluginsFromEntry`. The `register(dispatcher)` export registers node instances only; DAGs come from files.
- **`crawl:discover` builtin DAG** — `src/crawlers/crawl-discover.dag.jsonld`: a cyclic BFS embedded DAG for link discovery. Embedded in an orchestration via `EmbeddedDAGNode { dag: "crawl:discover" }` with `stateMapping` that seeds `urls` from `crawl.discovered`. Configured via the `crawler` block in `state.json`.
- **Parallel parse via dagonizer `WorkerThreadContainer`** — `parallelWorkers: true` in `state.json` binds a worker thread pool to the "worker" role. `ScatterNode` placements with `container: "worker"` route to the pool. Build with `npm run build:workers`.
- **`RunStateSchema`** (`src/schemas/internal/RunStateSchema.ts`) — AJV schema validating `state.json`: `baseUrl`, `apiUrl`, `cache`, `output`, `headers`, `crawler`, `urls`, `parallelWorkers`, `includeRawContent`, `outputSchema`, `onSchemaError`.
- **`PluginLoader`** (`src/run/PluginLoader.ts`) — static utility: `registerBuiltinNodes`, `registerPluginsFromEntry`, `derivePluginTaskName`, `pluginDagsInRegistrationOrder`.

### Removed

- **`ripperoni scrape`, `scrape-html`, `scrape-wiki`, `crawl`** CLI commands — the native `run` command replaces all four.
- **`ripperoni.config.json` / `RipperConfigSchema` / `RipperConfig`** — run params live in `<name>.state.json` validated by `RunStateSchema`.
- **`src/flows/`** — all runtime DAG builders (`htmlScrapeFlow`, `wikiScrapeFlow`, `htmlPageFlow`, `wikiPageFlow`, `cliScrapeFlow`, `configLoadFlow`, `linkCrawlFlow`, `registerAllFlows`) are removed. DAGs are now authored as committed `.dag.jsonld` documents.
- **`runHtml` / `runWiki`** — replaced by `runDag` / `runDagFromFiles`.
- **`ConfigClamp` / `ConfigLoadState` / `CliState`** — config loading and CLI dispatch DAGs removed with the old model.
- **`LinkLister`** (`src/crawlers/LinkLister.ts`) — replaced by the builtin `crawl:discover` DAG.
- **Multi-DAG bundle files** (`.dag.jsonld` arrays) — the runner expects a single orchestration DAG document; arrays are rejected with a clear error.

### Changed

- **Docs rewritten to the native DAG+state model.** All usage guides, walk-throughs, and architecture diagrams describe the `run`/`scaffold` commands, `state.json` configuration, and the DAG-document plugin contract.
- **Diagram generation + interactive explorer** (`docs/.vitepress/scripts/render-dags.mjs`, `docs/.vitepress/theme/mermaidExplorer.client.ts`) — renders the live native DAGs (the `aonprd:crawl` orchestration, `crawl:discover`, `aonprd:page`, plus the `aonprd:parse`/`docs:parse`/`wiki-docs:parse` plugin DAGs) and ships a client enhancer that adds a pan/zoom/centre/fit D-pad and a fullscreen explore modal (per-diagram fit by default). Stale diagrams for deleted flow builders are removed from `docs/_generated/`; a new **DAG Diagrams** page + sidebar entry collects them.

### Fixed

- **`*.dag.jsonld` assets are now copied into `dist`** — a new `build:assets` step (`scripts/copy-dag-assets.mjs`) mirrors authored DAG documents under `src/` into `dist/`. The runtime loads the builtin `crawl-discover` DAG by a path relative to the compiled module, so without the copy a built `ripperoni run` crashed with `ENOENT`. Verified by a full live AONPRD rip: 13,892 pages crawled, parsed, and written with zero failures.
- **Mermaid diagram rendering** — concrete theme colours (CSS `var()` crashed khroma and blanked every diagram), keyword-safe node IDs (a colon `:class` collided with mermaid's reserved word), stripped invalid terminal-label annotations, and raised the edge/text-size caps so the 191-node parse DAG renders.
- **Dead package exports removed** — `./LinkLister` and `./RipperConfig` pointed at modules deleted in the migration.

### Dependencies

- **Dagonizer is `@studnicky/dagonizer@0.24.0`** from GitHub Packages (`.npmrc` routes the
  `@studnicky` scope; auth token lives in `~/.npmrc`). The former vendored `@noocodex/dagonizer@0.9.2`
  tarball and `vendor/` directory are gone.

### Changed

- **Node model is the 0.23 batch contract.** Every node is a `ScalarNode` subclass implementing
  `executeOne` and returning `NodeOutputBuilder.of(port)`; nodes carry no `RipperServices` generic
  (they read state, not `ctx.services`). `RipperDagonizer` adapts the 0.23 hooks (`onNodeEnd(name,
  output, state, placementPath)`); the obsolete `onContractWarning`/`contractWarnings` surface is
  removed (dead-write contracts are hard `DAGError`s at `registerDAG`/`derive`). `HttpRetryPolicy`
  constructs via `RetryPolicy.from` with `BackoffStrategyNames`.
- **All flows use native `DAGBuilder`** (`.node`/`.scatter`/`.embeddedDAG`/`.terminal`).
  `configLoadFlow` is authored with explicit `.node()`/`.terminal()` placements and exhaustive
  route maps. The aonprd parse DAG is produced by `Taxonomy.buildDAG()`, which translates the
  internal annotation graph to `DAGBuilder` placements — the `/derive` subpath and `DAGDeriver`
  class are gone. Routing is read natively off `RoutedBatchType` (`result.has(port)`); capability
  chains are plain arrays (chainability via dagonizer's native `ChainableType`).
- **`OperationContractType` and contract fields removed.** The `contract` field is gone from
  every node class and from `NodeInterface`. `OperationContractType`, `OperationContractFragmentType`,
  and `EMPTY_CONTRACT_FRAGMENT` are removed from the dagonizer API. All node files in `src/nodes/`,
  `plugins/`, and `examples/` drop their contract declarations.
- **Worker-thread parse execution (default on).** The CPU-bound per-page plugin parse `embeddedDAG`
  runs in a `WorkerThreadContainer` pool (`@studnicky/dagonizer-executor-node`) sized to system info via
  `NodeSystemInfo.recommendedWorkerCount` — the full machine's parallelism (cores + free memory), no
  artificial cap — while fetch and write stay coordinator-side. The per-page scatter concurrency is set
  to the pool width so every worker stays fed. Controlled by `enableWorkers` on `runHtml` (default
  `true`); it falls back to in-process with a warning when the compiled worker tree is absent. The worker
  registry (`src/workers/parseRegistry.ts`) is plugin-agnostic: `instantiate(servicesConfig)` rebuilds
  whatever plugin parse DAG the run's `pipelineNames` describe via the extracted `PluginLoader` (shared by
  `runHtml`/`runWiki`) — same source, only the container execution swaps. The worker reconstructs its own
  services and state (`ScrapeState.restore`) in-isolate; only `page.html` (in) and `output` (out) cross
  the boundary. Worker threads can't transpile, so the worker dependency closure compiles to a
  self-contained `dist-workers/` tree (`npm run build:workers`, `tsconfig.workers.json`, chained into
  `npm run build`).
- **Link crawl is a single native cyclic DAG.** `crawl:dedupe-and-enqueue` routes `frontier-ready`
  back to `crawl:fetch-and-extract` — a back-edge the engine re-executes in place until the depth/budget
  guard routes to `crawl:exhausted`. This replaces the trampoline (`RecurseCrawlNode` dispatching a
  separate `linkCrawlLevelDAG` per depth level): `RecurseCrawlNode`, the level DAG, and the load-bearing
  `LinkCrawlState.clone()` override are gone. Behaviour is unchanged — same discovered/visited sets and
  depth/budget termination.
- **Per-page scrape uses a native `{ dag }`-body scatter.** The wiki and html scrape/retry phases
  scatter over `{ dag: perPageDagName }` — the framework clones the parent state per item (metadata
  only), sets `metadata.currentTitle`/`currentUrl`, dispatches the registered per-page DAG, and maps
  its terminal outcome (`completed`/`failed`) to the `success`/`error` partition. The per-page entry
  nodes (`WikiFetchNode`, `HtmlFetchNode`) initialise `state.page` from that metadata, absorbing the
  former `pageSetup` callback. `ScrapeState` drops its `clone()` override (the base metadata-only clone
  is correct now), so per-item clones no longer copy the accumulator arrays. The `DispatchPageDagNode`
  wrapper, the per-vertical docs dispatch nodes, and the `*:dispatch-page-dag` stubs are gone.
- **The whole test tree is type-checked** (`tsconfig.typecheck.json` covers `tests/**`). Single-character
  identifiers are banned via the `id-length` eslint rule.
- **Three noocodec contract eslint rules at `error`** (`eslint-rules/noocodec.mjs`):
  `interface-must-be-contract` (a method-less data `interface` must be a `type`), `logger-binding-name`
  (a `Logger.forComponent(...)` binding is named `log`), and `group-types-in-namespace` (exempts
  `src/types/`, ripper's canonical type-grouping barrel). Driven to zero violations: every data-shape
  `interface` is now a `type` alias and the `*Interface` suffix is renamed to `*Type` (the services
  bags `RipperServices`/`CliServices`/`LinkCrawlServices` keep their names as `type`); module-scoped
  logger bindings are renamed to `log`.

### Breaking

- **`_type` discriminator removed from every AON output.** Concept identity is no longer
  carried as a field on the output shape; it comes from the URL (the canonical
  source) or the concept-specific `<concept>_id` field. The Wave 6 M1 router-stamping
  indirection is gone with it: `ConceptOutputBase<T>` is deleted, `ConceptDecl.discriminator`
  is deleted, and the per-concept `discriminator: { _type: 'X' }` field was stripped from
  every `ConceptDecl`. The `XxxOutputFields` intermediate interface introduced during the
  router-stamping migration was collapsed back into a single `XxxOutput` interface per
  concept. Downstream consumers that pattern-matched on `out._type` need an alternate
  signal — typically URL inspection or the typed `XxxOutput[id]` accessor.
- `UnknownOutput` no longer carries `_type: 'unknown'`. The unknown fallback shape is now
  `{ url, unknown_id, ...baseFields }`.
- `RitualOutput` is now a structural alias for `SpellOutput` (was previously an
  intersection that varied only by the removed discriminator).
- **`./config/ConfigClamp` subpath export removed.** `ConfigClamp` (with `CLAMP_RULES`
  and `ClampRulesType`) is deleted — it had zero callers and config clamping was never
  wired into `RipperConfig.load`/`normalize`. Consumers importing
  `ripperoni/config/ConfigClamp` must drop the dependency.
- **Top-level `crawlers.<name>` config form removed.** A standalone crawler is configured
  via the embedded `targets.<name>.crawler` block — the only form the engine reads
  (`CrawlListTargetsNode`). Configs with a top-level `crawlers` key now fail schema
  validation; move each crawler under its target.

### Added

- **Bounded scrapes via `--paths`.** `scrape-html --paths X Y Z` now skips the configured
  `crawl:list-targets` node and treats the supplied paths as the bounded URL set.
  Full-target scraping (crawl + scrape) remains the default when `--paths` is omitted.
  `HtmlScraper.fetchPage` now normalises the base/path join — `Actions.aspx?ID=1`
  (no leading slash) becomes the correct URL instead of the malformed
  `https://example.comActions.aspx?ID=1`.

### Removed

- Plan/audit docs from `docs/`: `taxonomic-extraction-redesign.md`, `wave-6-audit-and-triage.md`,
  `plans/DAGONIZER-NATIVE.md`, `plans/RESUME.md`. All shipped; git history is the changelog.
- Superseded scripts: `audit-extraction-gaps.mjs`, `audit-raw-fields.mjs`,
  `sample-monster-abilities.mjs`, `verify-monster-abilities.mjs`,
  `verify-archetype-sections.mjs`, `verify-i18n-sample.mjs`, `reparse-cache.ts`. Two of
  these grouped outputs by the removed `_type` field; the rest were Wave 9 spot-check
  verifiers superseded by the corpus harness + e2e suite.
- Every `Wave N` / `Phase 6.X` comment label across `plugins/`, `src/`, and `tests/`
  (~263 references in ~69 files). Surrounding prose preserved or rewritten to describe
  current behavior without historical labels.
- **Dead config surface** (pre-release cleanup): `src/config/ConfigClamp.ts` (class +
  `CLAMP_RULES` + `ClampRulesType`) and the top-level `crawlers` JSON-schema block +
  `NormalizedRipperConfigType.crawlers` type field. The e2e/unit suite migrated to the
  embedded `targets.<name>.crawler` form; fixture `pathripper-legacy.config.json` renamed
  to `aonprd-crawler.config.json`.
- **Broken package exports** `./registry/PipelineState` and
  `./orchestrators/ScrapeOrchestrator` — both pointed at `dist/` paths whose source was
  removed in the dagonizer migration, so importing them failed at runtime.
- **Dead re-export barrels** `src/nodes/config/index.ts`, `src/nodes/crawl/index.ts`, and
  `src/run/index.ts` — zero importers; consumers import the concrete modules directly.

### Fixed

- `plugins/aonprd/parse.dag.ts` carried a stale `NodeInterface<…, RipperServices>` →
  `NodeInterface<…, undefined>` assignability mismatch at the `DAGDeriver.derive` boundary.
- Wave 10A split residue: `plugins/aonprd/concepts/skill/{helpers,concept}.ts` had broken
  cheerio Element/AnyNode imports (now from `domhandler`) and missing/redundant type
  exports; `plugins/aonprd/concepts/subclass-feature/base.ts` missing
  `SubclassFeatureSpellGroup` type import.
- `tsconfig.plugins.json` now excludes the unmigrated `plugins/bulbapedia/` stub.

### Quality gates

- `npx tsc --noEmit -p tsconfig.plugins.json` — clean
- `npm run typecheck:tests` — clean
- `npm run test:unit` — 971 pass / 0 fail
- `npm run test:e2e` — 126 pass / 0 fail
- Full corpus extraction: 13,657 pages / 4 known content-gap failures / 0/0/170 against
  committed Wave 5 baselines

## [3.0.0] - 2026-05-19

### Changed

- Bumped `@noocodex/dagonizer` to `0.8.1` (vendored `noocodex-dagonizer-0.8.1.tgz`). Renamed `FlowDeriver` → `DAGDeriver` and related types (`FlowAnnotations` → `DAGDeriverAnnotations`, `FlowFanOut` → `DAGDeriverFanOut`, `FlowTerminal` → `DAGDeriverTerminal`, `FlowDeepDAG` → `DAGDeriverSubDAG`) per upstream 0.8.0 breaking change. Every fan-out annotation gains an explicit `strategy` discriminator and a top-level `node:` field. Eliminated the remaining `DAGBuilder` calls in `src/run/runHtml.ts` and `src/run/runWiki.ts` using the new `DAGDeriverFanOut.strategy: 'partition'` annotation — ripperoni now has zero `DAGBuilder` calls; every DAG is contract-derived. Also eliminated `DAGBuilder` calls in `plugins/aonprd/parse.dag.ts` and `examples/` plugins.
- `linkCrawlFlow.ts` rebuilt as a trampolined recursive DAG. The crawler is now two `DAGDeriver.derive(...)` flows — `linkCrawlDAG` (init + first level) and `linkCrawlLevelDAG` (subsequent levels). The `crawl:recurse` node dispatches `linkCrawlLevelDAG` on a cloned state (clone carries `pending` lifecycle; the outer execution holds `running` on the original state; results are merged back after the recursive dispatch completes). Termination invariants (`frontier.length > 0`, `DedupeAndEnqueueNode` routing `frontier-empty`/`budget-exhausted` to `crawl:exhausted`) are preserved from the unrolled version. `Dagonizer.collectDeepDAGReferences` cycle check walks only `DeepDAGNode` placements and is silent on dynamic node-initiated dispatch. Neither `linkCrawlDAG` nor `linkCrawlLevelDAG` contains a `DeepDAGNode` placement, so the static graph remains acyclic.

### Breaking (dagonizer shim removal — complete)

- `ScrapeOrchestrator` class removed entirely. The composition root is `RipperRun`. Callers use `await (await RipperRun.forHtml(opts)).execute()` / `await (await RipperRun.forWiki(opts)).execute()`.
- `AppServices` interface (`src/nodes/Services.ts`) removed. The only services type is `RipperServices` (`src/services/RipperServices.ts`). Every node's `NodeInterface<TState, T, ...>` services parameter is `RipperServices`. Every `NodeContextInterface<RipperServices>` context type is `RipperServices`.
- `registerGlobalNode` / `registerGlobalDAG` / `GLOBAL_NODE_REGISTRY` / `GLOBAL_DAG_REGISTRY` removed. The globalThis-backed plugin bag is gone. Plugins now export `register(dispatcher: RipperDagonizer<ScrapeState>): void`. `RipperRun.forHtml` / `forWiki` import the plugin module and call `mod.register(dispatcher)` explicitly. No side-effect-on-import, no global state.
- `src/orchestrators/` directory removed (`ScrapeOrchestrator.ts`, `pluginRegistry.ts`).
- `src/nodes/Services.ts` removed.
- `RipperDagonizer<TState>` now extends `Dagonizer<TState, RipperServices>` (was `Dagonizer<TState, AppServices>`).
- `RipperServices.setDispatcher()` / `#dispatcher` type is `DagonizerInterface<ScrapeState, RipperServices>` (was `AppServices`).

## [3.0.0-pre.1] - 2026-05-18

### Added (squashage-pattern adoption — R-3 + R-4)

- `RipperRun` composition-root class: `RipperRun.forHtml(opts).execute()` / `await RipperRun.forWiki(opts)` then `.execute()`. Replaces the procedural composition in `ScrapeOrchestrator`. Owns the full construction of services + observer + dispatcher + all node and DAG registrations. The wiki batch loop (`RipperRunWiki`) is encapsulated inside `forWiki()`.
- `RipperServices` class (`src/services/RipperServices.ts`) — eager-construction services container; replaces the dynamic `AppServices` interface + proxy-based lazy holder. Static factories `forHtml(opts)` / `forWiki(opts)` resolve scrapers, cache, and output config from the target config slice. `setDispatcher()` injects the dispatcher reference after construction to break the circular dependency. Implements `AppServices` structurally for backward compatibility.
- `stub()` helper (`src/dags/helpers.ts`) — creates a typed `NodeInterface` placeholder for use inside DAGBuilder calls. The stub carries the correct `name` and `outputs` for type inference; its `execute()` throws immediately to catch registration bugs. Mirrors the squashage `src/dag/recordDag.ts` pattern.
- `src/orchestrators/pluginRegistry.ts` — extracted global node and DAG registry (`GLOBAL_NODE_REGISTRY`, `GLOBAL_DAG_REGISTRY`, `registerGlobalNode`, `registerGlobalDAG`, `BUILTIN_NODES`, `BUILTIN_PREFIXES`). Shared via `globalThis` backing store; `ScrapeOrchestrator` re-exports the full surface for backward compatibility.
- `src/dags/registerPageDagNodes.ts` — registers all nine built-in scrape-layer nodes onto a dispatcher before the page DAGs are registered.
- `src/dags/registerMemberResolutionNodes.ts` — registers the five wiki member-resolution nodes onto a dispatcher before `buildWikiResolveMembersDAG()` is called.

### Changed (squashage-pattern adoption — R-3 + R-4)

- All `src/dags/*.ts` files refactored to use `stub()` instead of importing and inlining concrete node instances. Each DAG file is a pure structural definition — it knows node names and output ports but not node implementations. `cliScrapeDAG.ts`, `configLoadDAG.ts`, `linkCrawlDAG.ts`, `htmlCrawlPhase.ts`, `wikiResolveMembersDAG.ts`, `htmlScrapeDAG.ts`, `wikiScrapeDAG.ts`, and the four phase DAGs all use stubs with node names that match the registered node `.name` properties.
- `ScrapeOrchestrator.scrapeHtml(opts)` / `.scrapeWiki(opts)` static methods are thin shims that delegate to `RipperRun.forHtml(opts).execute()` / `RipperRun.forWiki(opts).execute()`. Internal callers should migrate to `RipperRun` directly; the static surface stays for backward compatibility. All plugin import paths (`registerGlobalNode`, `registerGlobalDAG`) remain accessible from `'./orchestrators/ScrapeOrchestrator.js'`.

## [3.0.0-pre] - 2026-05-18

### Changed

- **Dagonizer dependency bumped to v0.5.0** (vendored tarball `vendor/noocodex-dagonizer-0.5.0.tgz`). The dependency reference moves from `file:../Dagonizer` (local workspace symlink) to a self-contained vendored tarball so the project builds without a sibling workspace. No source changes were required: ripperoni already used the v0.5.0 API surface (`DAGBuilder.deepDAG()` instead of the removed `subDAG()`, `DeepDAGNode` placement type, JSON-LD wire format via `DAGBuilder.build()`). The v0.5.0 `FanInStrategy` → `FanInStrategyName` constant rename and `SingleNodeInterface` → `SingleNodePlacementInterface` rename did not require source edits because ripperoni uses neither identifier directly. New v0.5.0 capabilities available but not yet consumed: per-node `timeoutMs`, `SignalComposer`, read accessors on `Dagonizer` (`getDAG`, `listDAGs`, `getNode`, `listNodes`), `./types` and `./core` subpath exports.



### BREAKING

- **Plugin contract changed.** Plugin entry points must now export a `NodeInterface<ScrapeState, TOutputs, AppServices>` and call `registerGlobalNode(node)` on import instead of `TaskRegistry.register(name, task)`. The old `(next, state) => Promise<void>` signature is removed.
- **Orchestration model changed.** `ScrapeOrchestrator` now dispatches via `@noocodex/dagonizer` DAGs instead of a sequential `Pipeline` middleware chain. Internal fan-out over URL/title lists is handled by the dagonizer `fan-out` placement with `partition` fan-in, replacing the old `ConcurrentPipeline` semaphore loop.
- **Deleted exports:** `./Pipeline`, `./ConcurrentPipeline`, `./registry/TaskRegistry`. Consumers that imported these must update to the dagonizer node API.
- `ScrapeOrchestrator.scrapeHtml` / `scrapeWiki` public signatures are unchanged; no CLI migration required.

### Added

- `RipperDagonizer` — `Dagonizer` subclass that forwards the 5 lifecycle hooks (`onFlowStart`, `onFlowEnd`, `onNodeStart`, `onNodeEnd`, `onError`) to an injected `RipperObserverInterface`. The dispatcher itself knows nothing about logging or metrics — observers are pluggable.
- `RipperObserverInterface` + `LoggerObserver` (default, forwards to `Logger.forComponent('Dispatcher')`) + `NullObserver` (no-op, for tests).
- `@noocodex/dagonizer` v0.4.0 DAG-based dispatch engine (already a `file:` dependency; now the primary orchestration mechanism).
- `src/state/ScrapeState.ts` — `NodeStateBase` subclass carrying page, output, urls, titles, succeeded, failed, recovered, failedAfterRetry with full checkpoint support via `snapshotData()` / `restoreData()`. Overrides `clone()` so domain fields survive sub-dag dispatch (the base implementation returns a bare `NodeStateBase`).
- `src/nodes/` — nine built-in `NodeInterface` implementations: `HtmlFetchNode`, `WikiFetchNode`, `HtmlWriteRawNode`, `WikiWriteRawNode`, `JsonWriteNode`, `JsonlAppendNode`, `ValidateSchemaNode`, `CrawlListTargetsNode`, `TerminalNode`. Each declares explicit output ports.
- `src/nodes/Services.ts` — `AppServices` interface passed to every node via `context.services`.
- `src/nodes/DispatchPageDagNode.ts` — `makeDispatchPageDagNode()` factory. The single node every per-item phase fan-out invokes; resolves the item key via a fallback list (`['currentUrl', 'currentRetryUrl']`) so the same wrapper serves both the scrape phase and the retry phase.
- Phase composition via `sub-dag` placements: `src/dags/htmlCrawlPhase.ts`, `htmlScrapePhase.ts`, `htmlRetryPhase.ts` (and wiki analogs `wikiScrapePhase.ts`, `wikiRetryPhase.ts`). Outer scrape DAGs (`htmlScrapeDAG`, `htmlScrapeDAGCrawl`, `wikiScrapeDAG`) are now first-class phase compositions — each phase is independently dispatchable for tests.
- Automatic per-item failure retry. Items that fail their first per-page DAG dispatch retry exactly once. `state.recovered` and `state.failedAfterRetry` expose the retry outcome; the retry phase reuses the same `DispatchPageDagNode` wrapper as the scrape phase.
- `registerGlobalNode` exported from `ScrapeOrchestrator` — the canonical self-registration hook for plugin nodes.
- `scripts/render-dag-diagrams.mjs` — generates Mermaid source files for canonical DAGs into `docs/_generated/` (now ten diagrams: three outer compositions, five phase DAGs, two per-page DAGs).
- `docs:dag-diagrams` npm script wired into `docs:build`.
- Architecture doc rewritten: "Pipeline pattern" → "DAG dispatch" with embedded Mermaid diagrams across every decomposition level — outer flow, discovery / scrape / retry phases, per-page child DAG.

### Changed

- **All plugins are now DAGs (Flavor 2 universal pattern).** Pipeline step names resolve to **either** a registered `NodeInterface` (emitting a `SingleNode` placement) **or** a registered `DAG` (emitting a `DeepDAGNode` placement). The orchestrator's pipeline-name resolution checks the DAG registry first, then the node registry — plugins are interchangeable from the config-author's perspective. Trivial plugins (`docs-scraper`, `wiki-docs`) wrap their single `NodeInterface` in a 1-node DAG; complex plugins (`aonprd`) decompose into multi-node branching DAGs. The user-facing pipeline config syntax (`pipeline: ['html:fetch', 'aonprd:parse', 'json:write']`) is unchanged — the resolution layer picks the right placement type at DAG-build time.
- The `aonprd:parse` plugin is now a 17-node plugin DAG: `load-and-common → detect-type → branch (15 page types) → extract-<type> → terminate`. Each per-type extractor (spell, monster, feat, weapon, armor, equipment, action, ancestry, class, background, condition, trait, hazard, generic) is an independently dispatchable node, and renders in the architecture diagram as its own placement.
- `registerGlobalDAG(dag)` exported from `ScrapeOrchestrator` alongside `registerGlobalNode(node)` — the canonical self-registration hook for plugin DAGs.
- CLI command action handlers now dispatch a Dagonizer `cliScrapeDAG`: `load-config → resolve-target → branch(html|wiki) → dispatch-X-scrape → write-manifest → exit`. The flow is independently testable and viz-renderable. `CliState` carries parsed options, resolved config, target kind, outDir, and exit code. Six CLI nodes (`cli:load-config`, `cli:resolve-target`, `cli:dispatch-html-scrape`, `cli:dispatch-wiki-scrape`, `cli:write-manifest`, `cli:exit`) live under `src/nodes/cli/`. The commander surface (commands, flags, exit codes, stdout/stderr) is unchanged.
- Config load is now a Dagonizer DAG (`configLoadDAG`): `read-file → parse-json → validate-schema → normalize-cache → assert-invariants`. Each step is an independently dispatchable node; per-step failures route to discrete output ports (`not-found`, `error`, `invalid`, `invariant-violated`). `RipperConfig.load(path)` keeps its signature; the implementation is now a thin dispatch wrapper.
- `failures.json` now reflects items that failed both the initial attempt AND the retry (was: first-attempt failures). Single-attempt behaviour is no longer expressible without rebuilding the outer DAG without the retry phase.
- **HTTP retry now uses `@noocodex/dagonizer/runtime` `RetryPolicy` directly.** `HtmlScraper`, `MediaWikiScraper`, and `LinkLister` construct an `HttpRetryPolicy` instance (a `RetryPolicy` subclass) instead of `RetryExecutor`. Backoff strategy: `DECORRELATED_JITTER` (same effective curve as v2.x). Retry decisions are driven by `ErrorClassifier.classify()` via an overridden `shouldRetry` — necessary because Ripperoni's HTTP errors are not segregated into distinct `Error` subclasses per category. `Retry-After` header backoff hints on HTTP 429 are honored via an overridden `getDelay`.
- **`ErrorClassifier` slimmed to pure classification.** `isRetryable()` removed; the `classify(err)` method is the sole public API. The `retryable` field in `ClassificationResultInterface` is retained as a classifier output consumed by `HttpRetryPolicy.shouldRetry`.
- `LinkLister` is now backed by a Dagonizer DAG (`linkCrawlDAG`): `init-frontier → [level: fetch-N → dedupe-N]* → exhausted`. Each level is a `FetchAndExtractLinksNode` (processes all frontier URLs, writes discovered links to `discoveredRaw` / `nextFrontierRaw`) followed by `DedupeAndEnqueueNode` (deduplicates, promotes to next frontier, routes to `exhausted` on empty frontier or budget/depth limit). Up to 16 levels are unrolled at registration time (Strategy B — bounded inline iteration); `DedupeAndEnqueueNode` enforces caller-supplied `maxPages` and `maxDepth` at runtime. The crawl is BFS rather than DFS. Public `LinkLister.create(cfg).buildList(urls)` signature unchanged.

### Removed

- `src/pipeline/Pipeline.ts` — middleware chain replaced by dagonizer.
- `src/pipeline/ConcurrentPipeline.ts` — fan-out concurrency replaced by dagonizer fan-out placement.
- `src/registry/TaskRegistry.ts` — global task registry replaced by `registerGlobalNode` + `GLOBAL_NODE_REGISTRY`.
- `src/registry/builtinTasks.ts` — individual task functions replaced by `NodeInterface` implementations in `src/nodes/`.
- Package exports `./Pipeline` and `./ConcurrentPipeline` removed.
- **`RetryExecutor` removed** (`src/modules/http/retryExecutor.ts`, `src/types/RetryExecutor.ts`, package export `./RetryExecutor`). Replaced by `@noocodex/dagonizer/runtime` `RetryPolicy` (via `HttpRetryPolicy`). Consumers that imported `./RetryExecutor` must use `RetryPolicy` from `@noocodex/dagonizer/runtime` directly.

### Changed

- `MediaWikiScraper` reduced to primitive fetch methods (`fetchPagesBatch`, `fetchCategory`, `fetchAllPages`). `scrapeCategory` removed — it combined member listing and wikitext fetching in a way that duplicated orchestrator-level concerns. Mode selection (resume-failures / single-category / by-categories / all-pages) moved out of `ScrapeOrchestrator.scrapeWiki()` and into `wikiResolveMembersDAG` — a DAG with discrete branch nodes per mode. Each mode is independently dispatchable for tests.
- `HtmlScraper` audited and trimmed of dead code. The class remains a single fetch primitive consumed by `HtmlFetchNode`.

### Added

- `src/dags/wikiResolveMembersDAG.ts` — four-branch mode-selection DAG. Each branch node (`wiki:resume-failures`, `wiki:fetch-single-category`, `wiki:fetch-multiple-categories`, `wiki:fetch-all-pages`) calls the appropriate `MediaWikiScraper` primitive and writes `state.members`. Dispatched as the first step of `scrapeWiki()` before the page fan-out phase.
- `src/nodes/wiki/` — five new node implementations: `ChooseModeNode` (priority-order mode selector), `ResumeFailuresNode`, `FetchSingleCategoryNode`, `FetchMultipleCategoriesNode`, `FetchAllPagesNode`.
- `src/state/MemberResolutionState.ts` — dedicated `NodeStateBase` subclass for the member-resolution phase; carries `target`, `config`, `resumeFailures`, `category`, and `members`.
- `docs/_generated/wikiResolveMembersDAG.mmd` — Mermaid diagram of the four-branch DAG.

### Tests

- Retry/backoff tests now run on `VirtualScheduler` + `VirtualClockProvider` from `@noocodex/dagonizer/testing` — deterministic virtual time, no real sleeps. The new `tests/unit/modules/http/RetryPolicy.test.ts` drives all retry scenarios (success, network retry, max-attempts exhaustion, permanent abort, Retry-After hint, abort-signal mid-retry) by advancing the virtual scheduler.
- `tests/unit/nodes/wiki/ChooseModeNode.test.ts` — 5 tests covering all four mode branches and priority ordering.
- `tests/unit/dags/wikiResolveMembersDAG.test.ts` — 6 integration tests for the full DAG: each branch populates `state.members`, deduplication in by-categories, error handling on missing failures.json, structural DAG check.

## [2.6.0] - 2026-05-18

### Changed

- **BREAKING: Cache defaults to on.** Targets and mediawiki entries that omit a `cache`
  block now receive `{ dir: 'output/.cache/<targetId>', mode: 'read-write' }` automatically.
  Combined with v2.5.0's `includeRawContent: true` default, raw content is always preserved
  by default and never re-fetched on subsequent runs without explicit opt-out.

- **BREAKING: Raw + cache-off rejected at config load.** Setting `cache.mode: 'off'`
  while `includeRawContent` is true (or absent — the default is true) throws
  `RipperConfigError` at `RipperConfig.load()`. Either set `includeRawContent: false`
  or pick a write-capable cache mode (`'read-write'` or `'write-only'`). Raw output
  without a cache exhausts disk on large scrapes — the loader catches the
  misconfiguration before a single byte is fetched.

- `RipperConfig.load()` return type narrowed from `Promise<RipperConfigInterface>` to
  `Promise<NormalizedRipperConfigInterface>` — the resolved shape where every `cache`
  block is guaranteed present. `ScrapeHtmlOptionsInterface.config` follows.

- `plugins/aonprd/parse.task.ts` imports `TaskRegistry`, `PipelineStateInterface`, and
  `TaskFnInterface` from `src/` instead of `dist/`. Single canonical source: the
  orchestrator (under tsx) and the plugin now reference the same `TaskRegistry`
  module instance, eliminating the dual-instance bug that prevented the full-pipeline
  e2e test from finding the eager-registered plugin.

### Added

- `RipperConfig.normalize(config)` static method exposes the cache-default + invariant
  pass for callers with an already-validated raw config.
- `RAW_CACHE_OFF_ERROR` exported constant carrying the exact rejection message text.
- Types: `ResolvedCacheConfigInterface`, `NormalizedTargetConfigInterface`,
  `NormalizedWikiConfigInterface`, `NormalizedRipperConfigInterface`.
- JSON Schema 2020-12 metadata enrichment on `RipperConfigSchema` — every block carries
  native `title`, `description`, `examples`, `default`, `$comment` keywords. The new
  `tests/unit/config/schemaExamples.test.ts` walks every nested `examples[]` and
  validates each entry against its own (sub)schema so documented examples cannot
  silently drift from the live structure.
- Docs site SEO infrastructure: full favicon stack (SVG canonical + PNG fallbacks +
  shortcut + apple-touch + mask-icon + manifest + sitemap + RSS alternate),
  Open Graph (12 properties, 1200×630 dimensions), Twitter Card (`summary_large_image`),
  four JSON-LD schemas (`SoftwareSourceCode` + `WebSite` + `Organization` per site,
  `BreadcrumbList` per page, `HowTo` on `recipes/*` and `walk-through`),
  preconnect + dns-prefetch hints, `hreflang` `en-US`/`x-default`, robots/keywords/
  author/referrer metas, search-console verification meta tags (suppressed when
  empty), `sitemap.xml` and `feed.xml` (RSS 2.0 from CHANGELOG) generated at build
  time, `manifest.webmanifest` (PWA, scope `/Ripperoni/`), `robots.txt`, `llms.txt`
  (AI/LLM-friendly site index), `favicon.svg`.
- `ripperoni.seo` block in `package.json` (`googleSiteVerification`, `bingSiteVerification`,
  `twitterHandle`, all empty by default; populating a value emits the corresponding
  meta tag on the next build).
- `docs/architecture.md` wraps each architectural section in
  `<section data-component="…">` with `<p class="summary">` markers — restores the
  docs-as-fixtures pattern that powers `tests/e2e/docs-html.test.ts`.

### Fixed

- `tests/e2e/docs-html.test.ts` now builds `docs/.vitepress/dist/` on demand and
  serves it over a node:http fixture server instead of fetching the live deployed
  site, making the test deterministic and runnable without network access.
- `tests/e2e/aonprd-plugin.test.ts` full-pipeline subtest now uses a deterministic
  sample of stable AON detail URLs instead of whichever pages the crawler surfaces
  from the seed; the assertion that every parsed record carries a `name` is exercised
  against known-good content rather than crawler-discovered admin/theme pages.

### Dependencies

- `vitepress-plugin-mermaid` and `mermaid` added as devDependencies. Renders mermaid
  code blocks in `docs/architecture.md` as interactive SVG diagrams.

## [2.5.0] - 2026-05-07

### Changed

- **Behaviour change vs PR #47 (same develop cycle, no released version affected):** `includeRawContent` default inverted from `false` to `true`. Raw content is now written to every output record by default; set `includeRawContent: false` to opt out and strip `_raw`. Rationale: parsing throws information away; the cheapest, most lossless default is to preserve the raw input. Plugins and downstream consumers can always rely on `_raw` being present without explicit config. The opt-out exists for storage-constrained production scrapes (~1.2 GB overhead for 15K AONPRD records at ~80 KB each).
- **Output folder layout:** plugin JSON output now writes to `output/<target>/<pluginTaskName>/<filename>.json` (a subfolder named after the plugin task, e.g. `aonprd:parse/`); raw HTML/wikitext writes to `output/<target>/raw/<filename>.html` (always populated when a fetch happens). Filename derivation is URL-based (`Feats.aspx?ID=750` -> `Feats.aspx-ID-750`), preserving the path extension for content-type identification at a glance. The legacy single-folder layout is opt-out via `output.splitByTaskName: false`.
- AONPRD e2e fixture config (`tests/e2e/fixtures/pathripper-legacy.config.json`): removed now-redundant `includeRawContent: true` (the default fires).
- Unit tests updated: assertions inverted to match new default-on semantics. Added test for explicit opt-in and for opt-out (`includeRawContent: false`). Added test asserting `_raw` is populated even when no plugin task runs (raw-dump-only pipeline).
- Integration tests updated: default-absent test now asserts `_raw` IS present. Added test for `includeRawContent: false` opt-out. Added test for a no-plugin pipeline producing a valid raw dump.
- Documentation (`docs/usage/configuration.md`): Raw Content section rewritten to reflect new default-on model; documents opt-out path with rationale; documents raw-dump-only pipelines (no plugin step) as a first-class supported use case. Output Layout section rewritten with directory tree, filename derivation table, and `splitByTaskName` escape hatch.

### Added

- `includeRawContent` boolean flag on `targets` and `mediawiki` target configs (default now `true`). Each output record gains a `_raw` field: `{ contentType: string, content: string, fetchedAt: string }` carrying the raw fetched response body byte-for-byte unless explicitly opted out. Downstream consumers (e.g. Squashage v0.6.0 max-extraction) can always rely on `_raw` being present.
- Raw-dump-only pipelines: a pipeline of `["html:fetch", "json:write"]` with no plugin task is now a fully supported and documented use case. Output records contain `_raw` with the full fetched HTML; `output` fields are empty (no plugin ran). Useful for archiving or deferred parsing.
- `output.rawSubdir`, `output.rawExt`, `output.splitByTaskName` config keys for tuning the raw/plugin folder split.
- `html:write-raw` and `wiki:write-raw` built-in tasks: write raw fetched bytes to `raw/` subfolder independently of the plugin task.
- AONPRD plugin: comprehensive cache-driven extraction enhancement. All per-type
  extractors now capture additional structured fields discovered by sampling the
  14,933-page AON HTML cache.

  **Common (all types):** `meta_description`, `meta_keywords` (from page `<meta>` tags).

  **All per-type outputs:**
  - `entity_id` / `feat_id` / `spell_id` / `monster_id` / `weapon_id` / `armor_id` /
    `equipment_id` / `action_id` -- numeric AON ID extracted from the URL query string.
  - `trait_ids` -- `Record<string, number>` mapping trait name to Traits.aspx ID;
    promoted from the internal `TraitInventory` to every output shape.
  - `sources` -- full `SourceRef[]` array (header + body footnotes) promoted to every
    output shape (previously only `source` (first ref) was exposed).

  **Feat:** `related_feats[]` (links from the `Related Feats` inline field),
  `is_mythic` (detected from level_kind or Mythic trait).

  **Spell:** `spell_id`, `defense` (remaster `<b>Defense</b>` field, e.g. "AC",
  "basic Fortitude"), `deities[]`, `mysteries[]`, `patron_themes[]`, `catalysts[]`.

  **Monster:** `monster_id`, `family_links[]` (from `Related Groups`, deduplicated by
  name -- sourced from `c.links` to handle pages where the field is post-stat-block).

  **Weapon:** `weapon_id`, `trait_ids`, `sources`.

  **Armor:** `armor_id`, `trait_ids`, `sources`.

  **Equipment:** `equipment_id`, `trait_ids`, `sources`.

  **Background:** `related_sources[]` (Sources.aspx links from the `Related Sources`
  field, present on ~80% of background pages).

  **Action, Condition, Trait, Hazard, Ancestry, Class, Generic, Unknown:** all now
  carry `entity_id`, `trait_ids`, `sources`, `meta_description`, `meta_keywords`.

- New fixture HTML pages added under `tests/e2e/plugins/fixtures/aonprd/`:
  `feat-hedge-prison.html`, `feat-with-related-feats.html`,
  `spell-with-defense.html`, `spell-with-deities.html`,
  `monster-with-family.html`, `weapon-longsword.html`.

- 21 new test cases in `tests/e2e/plugins/aonprd.parse.test.ts` covering all new
  fields (entity IDs, meta tags, trait_ids, sources[], spell defense/deities, feat
  related_feats, monster family_links, weapon IDs).

## [2.4.0] - 2026-05-06

### Changed

- Em-dashes (`—`) replaced with plain punctuation (`: ` for list/definition items, `; ` for clause joins, `, ` mid-sentence) across `README.md`, `docs/**/*.md`, `package.json`, and `docs/.vitepress/config.ts`. ~95 occurrences total. CHANGELOG history left untouched.

### Added

- Mechanism-depth expansions across user-facing docs (architecture, pipeline, cache, scrapers, configuration, crawler, mediawiki, plugins) following the yamete-fidelity bar: problem framing, state machines, error propagation, parameter rationale, edge cases.

### Changed

- GitHub Actions baseline: `actions/upload-artifact` 4 → 7, `actions/upload-pages-artifact` 3 → 5, `actions/deploy-pages` 4 → 5, `actions/github-script` 7 → 9.

## [2.3.0] - 2026-05-05

### Added

- Docs site favicon: VitePress `head` block now declares the salami logo as the page icon, parallel to Squashage.

### Changed

- Dependency baseline refresh:
  - `typescript` 5.9.3 → 6.0.3
  - `@types/node` 22.19.17 → 25.6.0
  - `commander` 12.1.0 → 14.0.3
  - `globals` 15.15.0 → 17.6.0
  - `typescript-eslint` 8.59.0 → 8.59.2 (minor-and-patch group)
  - `eslint-ecosystem` group: 2 patch updates
- GitHub Actions baseline:
  - `actions/setup-node` 4 → 6


### Added

- Docs site favicon — VitePress `head` block now includes `<link rel="icon" href="/Ripperoni/ripperoni.png">`. Tab icon now matches the navbar logo, parallel to Squashage's setup.

## [2.2.2] - 2026-05-06

### Fixed

- VitePress `base` and all internal `/PathRipper/...` URL references corrected to `/Ripperoni/`. The deployed docs site at https://studnicky.github.io/Ripperoni/ was 404-ing every asset because the build still pointed at the pre-rename path. README clone URL, walk-through `User-Agent` example, edit-this-page link, and the live-docs e2e test target all updated to the canonical Ripperoni URL.

## [2.2.1] - 2026-05-06

### Added

- CI + dependabot alignment with json-tology canonical pattern: `changelog-check.yml`, `license-check.yml`, `security.yml`, `stale.yml`, and `publish.yml` (npm publish disabled by default via `vars.NPM_PUBLISH_ENABLED`). Dependabot auto-update config for dependencies, npm, and GitHub Actions.
- Cross-reference in `README.md` and package description linking to Squashage for RDF graph reconstitution.

### Changed

- `.gitattributes`: merged json-tology's line-ending and export-ignore rules; preserved Ripperoni's linguist vendoring hints for test fixtures.
- Package description: now emphasizes ingestion → RDF pipeline with Squashage.
- VitePress `config.ts` description field updated to reflect Squashage integration.
- `.gitattributes`: scraped AON HTML test fixtures (`tests/{e2e,unit}/plugins/fixtures/**/*.html`) marked `linguist-vendored=true` so GitHub's language detector reports the repo as the TypeScript ingestion engine it is, not majority-HTML.

## [2.2.0] - 2026-05-05

### Added

- VitePress documentation site at `docs/` (modeled on the json-tology template). New navbar logo, salami-red accent palette, dark mode default. Per-concept Usage section: cache, configuration, crawler, mediawiki, pipeline, plugins, scrapers. Walk-through page using the Pathfinder/aonprd target.
- `docs/index.md` uses `layout: doc` so the sidebar is visible on the home page.
- `.github/workflows/pages.yml`: GitHub Pages deploy via `docs:build`.

### Changed

- `crawl:list-targets` no longer requires `--paths` for html targets — listing-only operations on html-typed targets now run without the flag.

### Removed

- `docs/plans/` and `docs/roadmap.html` — replaced by the VitePress site.

## [2.1.0] - 2026-05-01

### Added
- `ConcurrentPipeline<TState>` — bounded-concurrency batch executor; wraps a shared `Pipeline` with a semaphore, fans N states through it simultaneously; shared cache and scraper instances flow through `state.context` naturally
- `concurrency` config field on both `targets.<id>` and `mediawiki.<id>` (integer 1–32, default 1)
- 6 unit tests for `ConcurrentPipeline` covering: full execution, failure isolation, semaphore ceiling, sequential mode, empty input, and cross-execution state isolation

### Changed
- `ScrapeOrchestrator.runPipeline` uses `ConcurrentPipeline` — one shared Pipeline instance per batch, N pages processed in parallel when `concurrency > 1`
- Roadmap updated: task registry, checkpoint/resume, config validation, and concurrent pipeline moved to shipped section

## [2.0.4] - 2026-05-01

### Removed
- `docs/roadmap.html`: companion tools section (mobile-app extractor, console ROM data ingester) — removed entirely, never planned
- All references purged from git history via `git filter-repo`

## [2.0.3] - 2026-05-01

### Fixed
- RateLimiter tests rewritten with 300ms delay and perSecond(5) — resilient to OS scheduler variance on loaded machines (eliminates repeated flaky failures)

## [2.0.2] - 2026-04-30

### Changed
- All "Torus" references replaced with **TORUS** *(Topological Orchestration Runtime for Unified Streaming)* — described as an upcoming streaming DAG orchestration tool currently under development
- Docs color palette rebuilt from pixel-accurate extraction of the ripperoni icon: `--meat` `#f05870`, `--meat-deep` `#c82840`, `--fat` `#f6d1cf`, `--blue` `#2090e0`, `--blue-deep` `#103050`, `--ink` `#2e0104`
- Background surfaces, borders, code blocks, and Mermaid diagrams all updated to the extracted palette
- Foreground text warm-shifted to echo the fat marbling tone (`#ede0df`)

## [2.0.1] - 2026-04-30

### Fixed
- `perSecond(n)` timing test floor lowered from 95ms to 85ms (±15ms tolerance, consistent with earlier `withDelay` fix)
- Color theme declared once in `sidebar.css` — removed three duplicate `:root` blocks and two stale orange accent values (`#ff7c42`) from `architecture.html` and `roadmap.html`
- Mermaid diagram stroke colors updated to match crimson theme
- Favicon and `<meta name="description">` added to architecture and roadmap pages

## [2.0.0] - 2026-04-30

### Added
- Ripperoni icon (`docs/assets/ripperoni.png`) — a semi-cartoon salami being sliced, because the project is a web ingestion engine and this is the branding it deserves
- Favicon and `<link rel="icon">` on all docs pages
- CI, docs, node, and version badges in README
- README links updated to point at the live GitHub Pages docs
- Sidebar "View on GitHub" button; Releases and Issues links in sidebar page nav
- `workflow_dispatch` on pages.yml for manual deploys

### Changed
- Docs accent color updated from orange to crimson-red (`#c8284a`) to match the icon palette
- Sidebar tagline: "Web ingestion engine. It slices. You eat."
- Intro copy rewritten with slicer/ingestion branding
- `tasks` field corrected to `pipeline` throughout docs and README (breaking rename from beta)
- MediaWiki feature card updated: native fetch, three scrape modes
- Footer updated: Node 24+, correct version, full link set
- Node requirement updated from 20+ to 24+ everywhere

### Fixed
- `docs-html` e2e test: spurious `TaskRegistry.reset()` call cleared the plugin registered in `before()`, causing `docs:parse` not found on every run

## [2.0.0-beta.5] - 2026-04-30

### Fixed
- GitHub Pages deployment: enable the Pages site via API and add `workflow_dispatch` trigger so deployments can be manually re-run

## [2.0.0-beta.4] - 2026-04-30

### Changed
- E2E tests no longer require `RIPPER_E2E=1` or `RIPPER_E2E_FULL=1` environment variables — tests run when you run `npm run test:e2e`, full stop

## [2.0.0-beta.3] - 2026-04-30

### Fixed
- RateLimiter unit test timing tolerance widened from ±5ms to ±15ms to prevent spurious failures on loaded CI runners

## [2.0.0-beta.2] - 2026-04-30

### Added
- **Docs-as-fixtures**: `docs/architecture.html` enriched with `data-component` attributes and `.summary` paragraphs — the documentation page is simultaneously the HTML scraper fixture
- **Wiki fixture server**: self-contained `node:http` server at `tests/e2e/fixtures/wiki/server.ts` serves the same 5 core-component pages as MediaWiki API responses (no network required)
- **`wiki-docs` e2e test**: scrapes the local fixture server via MediaWiki mode, runs `wiki-docs:parse` pipeline, asserts `_type: 'ripperoni_component'` on all 5 pages, writes outputs to `examples/wiki-docs/output/`
- **`docs-html` e2e test** (gated on `RIPPER_E2E=1`): scrapes `https://studnicky.github.io/PathRipper/architecture.html`, asserts ≥3 `docs_section` outputs
- **`examples/docs-scraper/plugin.ts`**: extracts `section[data-component]` headings and summaries from HTML docs pages
- **`examples/wiki-docs/plugin.ts`**: parses `{{RipperoniComponent}}` wikitext template, extracts `name`, `kind`, `since`, `description`, `source`
- **GitHub Pages deployment** (`pages.yml`): deploys `docs/` to `https://studnicky.github.io/PathRipper/` on every push to master

## [2.0.0-beta.1] - 2026-04-30

Complete TypeScript v2 rewrite of [PathRipper](https://github.com/Studnicky/PathRipper) (2019).
Ripperoni is a target-neutral, configuration-driven web scraper with a plugin-driven
extraction pipeline. Plugin source files ship separately as examples in v1.

### Added

**Core engine**
- `Pipeline` — typed async middleware chain; tasks receive `(next, state)` and chain with `next()`
- `HtmlScraper` — native `fetch` + cheerio; no JSDOM or browser engine
- `MediaWikiScraper` — direct MediaWiki JSON API; three-mode enumeration (single category / `categories[]` array / full-site `allpages`)
- `WikitextParser` — `wtf_wikipedia` wrapper with `infoboxField`/`infoboxNumber` typed accessors
- `LinkLister` — recursive link crawler with separated `#visited`/`#collected` sets; supports `startUrls[]`, `maxPages`, `jitterMs`
- `TaskRegistry` — plugin loader; registers task functions by name, loads plugins via dynamic import
- `PipelineState` — typed state bridge between scrapers and pipeline tasks
- `ScrapeOrchestrator` — coordinates scrape runs; resume/retry via `failures.json`; redirect resolution via `redirects=1` API param
- `ScraperCache` — sharded, content-addressed pointer cache with `read-write`/`read-only`/`write-only`/`off` modes and TTL/LRU eviction
- `ConfigClamp` — validates and clamps all numeric config values to valid ranges with `warn`-level logging per violation
- `BaseError` + named error hierarchy — ported from `@noocodec/cogitator`: `HttpError`, `RipperConfigError`, `MappingError`, `ExternalSchemaError`; all errors carry `code`, `retryable`, `cause`, `metadata`

**Configuration**
- AJV-validated JSON config (`ripperoni.config.json`) with full `json-schema-to-ts` derived types
- All parameters configurable with documented defaults: `rateLimitMs`, `jitterMs`, `batchSize`, `allPagesLimit`, `maxRetries`, `retryBaseDelayMs`, `retryMaxDelayMs`

**CLI**
- `ripperoni scrape` — unified command; detects `html`/`mediawiki` mode from config
- `ripperoni crawl` — collects target URLs via `LinkLister`; `--starts`, `--jitter`, `--max`
- `ripperoni scrape-html` / `ripperoni scrape-wiki` — explicit mode commands

**Developer experience**
- Native git hooks (`hooks/pre-commit`, `hooks/pre-push`); installed via `scripts/install-hooks.sh`
- Matrix CI: Node 22/24 × ubuntu/macos; typecheck, lint, unit tests, build, audit
- CHANGELOG gate on every PR
- 90 unit tests (framework core); `node:test` native runner, `tsx`, no jest/vitest; target-specific plugin tests live in `tests/e2e/` alongside their plugin source
- Legacy PathRipper AONPRD e2e preserved at `tests/e2e/` (`npm run test:e2e`; never runs in CI)
- `scripts/enginseer.sh` — local wrapper for `@noocodec/enginseer` analytical tools

### Changed
- Package renamed `ripperoni` (was `pathripper`); bin `ripperoni`
- All source rewritten in TypeScript strict mode; ESM/NodeNext
- Config renamed `ripperoni.config.json`; `tasks` field renamed `pipeline`
- `startUrl` (singular) → `startUrls` (array) on crawler config
- mwn upgraded to `^3.0.2` (clears transitive axios CVE chain)
- Default MediaWiki rate limit raised to 2000 ms + 500 ms jitter (was 1000/250); prevents 503s on Bulbapedia-scale scrapes

### Security
- `npm audit --omit=dev` exits 0; all production dependency advisories resolved

[Unreleased]: https://github.com/Studnicky/PathRipper/compare/v2.1.0...HEAD
[2.1.0]: https://github.com/Studnicky/PathRipper/compare/v2.0.4...v2.1.0
[2.0.4]: https://github.com/Studnicky/PathRipper/compare/v2.0.3...v2.0.4
[2.0.3]: https://github.com/Studnicky/PathRipper/compare/v2.0.2...v2.0.3
[2.0.2]: https://github.com/Studnicky/PathRipper/compare/v2.0.1...v2.0.2
[2.0.1]: https://github.com/Studnicky/PathRipper/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/Studnicky/PathRipper/compare/v2.0.0-beta.5...v2.0.0
[2.0.0-beta.5]: https://github.com/Studnicky/PathRipper/compare/v2.0.0-beta.4...v2.0.0-beta.5
[2.0.0-beta.4]: https://github.com/Studnicky/PathRipper/compare/v2.0.0-beta.3...v2.0.0-beta.4
[2.0.0-beta.3]: https://github.com/Studnicky/PathRipper/compare/v2.0.0-beta.2...v2.0.0-beta.3
[2.0.0-beta.2]: https://github.com/Studnicky/PathRipper/compare/v2.0.0-beta.1...v2.0.0-beta.2
[2.0.0-beta.1]: https://github.com/Studnicky/PathRipper/releases/tag/v2.0.0-beta.1
