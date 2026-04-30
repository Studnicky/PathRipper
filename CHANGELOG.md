# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/Studnicky/PathRipper/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/Studnicky/PathRipper/compare/v2.0.0-beta.5...v2.0.0
[2.0.0-beta.5]: https://github.com/Studnicky/PathRipper/compare/v2.0.0-beta.4...v2.0.0-beta.5
[2.0.0-beta.4]: https://github.com/Studnicky/PathRipper/compare/v2.0.0-beta.3...v2.0.0-beta.4
[2.0.0-beta.3]: https://github.com/Studnicky/PathRipper/compare/v2.0.0-beta.2...v2.0.0-beta.3
[2.0.0-beta.2]: https://github.com/Studnicky/PathRipper/compare/v2.0.0-beta.1...v2.0.0-beta.2
[2.0.0-beta.1]: https://github.com/Studnicky/PathRipper/releases/tag/v2.0.0-beta.1
