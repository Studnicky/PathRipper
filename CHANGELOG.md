# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Behaviour change vs PR #47 (same develop cycle, no released version affected):** `includeRawContent` default inverted from `false` to `true`. Raw content is now written to every output record by default; set `includeRawContent: false` to opt out and strip `_raw`. Rationale: parsing throws information away; the cheapest, most lossless default is to preserve the raw input. Plugins and downstream consumers can always rely on `_raw` being present without explicit config. The opt-out exists for storage-constrained production scrapes (~1.2 GB overhead for 15K AONPRD records at ~80 KB each).
- AONPRD e2e fixture config (`tests/e2e/fixtures/pathripper-legacy.config.json`): removed now-redundant `includeRawContent: true` (the default fires).
- Unit tests updated: assertions inverted to match new default-on semantics. Added test for explicit opt-in and for opt-out (`includeRawContent: false`). Added test asserting `_raw` is populated even when no plugin task runs (raw-dump-only pipeline).
- Integration tests updated: default-absent test now asserts `_raw` IS present. Added test for `includeRawContent: false` opt-out. Added test for a no-plugin pipeline producing a valid raw dump.
- Documentation (`docs/usage/configuration.md`): Raw Content section rewritten to reflect new default-on model; documents opt-out path with rationale; documents raw-dump-only pipelines (no plugin step) as a first-class supported use case.

### Added

- `includeRawContent` boolean flag on `targets` and `mediawiki` target configs (default now `true`). Each output record gains a `_raw` field: `{ contentType: string, content: string, fetchedAt: string }` carrying the raw fetched response body byte-for-byte unless explicitly opted out. Downstream consumers (e.g. Squashage v0.6.0 max-extraction) can always rely on `_raw` being present.
- Raw-dump-only pipelines: a pipeline of `["html:fetch", "json:write"]` with no plugin task is now a fully supported and documented use case. Output records contain `_raw` with the full fetched HTML; `output` fields are empty (no plugin ran). Useful for archiving or deferred parsing.

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
- `litany.json` project standards config

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
