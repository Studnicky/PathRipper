# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- TypeScript rewrite of the PathRipper pipeline: `Pipeline`, `LinkLister`,
  `HtmlScraper`, `MediaWikiScraper`, `WikitextParser`, `RetryExecutor`,
  `RateLimiter`, `ErrorClassifier`, `Logger`.
- CLI: `ripperoni scrape-html`, `ripperoni scrape-wiki`, `ripperoni crawl`.
- Configurable target system — no target hardcoded in source.
- Internal JSON Schema for `ripperoni.config.json`, derived TS types via
  `json-schema-to-ts`, runtime validation with AJV + ajv-formats. Malformed
  configs now fail fast at load with a precise field-path error message.
- `ripperoni.config.example.json` at repo root (target-neutral placeholders only).
- `docs/plans/` lane-by-lane remediation plan (00 current state, 01–11 lanes).
- `CHANGELOG.md`, husky pre-commit/pre-push gates, target-neutrality grep gate.
- `.github/pull_request_template.md`.

### Changed
- CLI default config path aligned to `./ripperoni.config.json` (matches README and
  bin name; previous default was `./ripper.config.json`).
- CLI uses static imports throughout — no `await import()` inside action handlers.
- Project renamed to `ripperoni`; PathRipper repository remains as historical reference.
- All target-specific names (real wikis, sites, franchises) scrubbed from source,
  README, and docs. Documentation uses `example.com` / `wiki.example` / `<your-target>`
  placeholders only.

### Fixed
- `LinkLister` constructor previously assigned `config.delimiter` to `#target` before
  overwriting via a `void config.target` lint suppression. Reduced to a single
  correct assignment per field.
- `LinkLister` recursive crawl previously added every classified link to a single
  `#history` set, which caused the entry-level early exit (`if (history.has(url))`)
  to short-circuit every traversal page on first visit and return zero matches.
  Split into `#visited` (URLs we've started crawling) and `#collected` (target URLs
  collected) so recursion proceeds while target dedup is preserved.
- `MediaWikiScraper.fetchPagesBatch` previously called `this.#bot.massQuery(...)` on
  `mwn@1.11`, with results processed via `Record<string, unknown>` casts. Rewritten
  to use `mwn`'s typed batch overload `bot.read(titles[])` returning `ApiPage[]` —
  zero `as { ... }` casts in `MediaWikiScraper.ts`.

### Security
- Upgraded `mwn` to `^3.0.2` to clear the transitive `axios <=0.30.3` advisory chain
  (GHSA-wf5p-g6vw-rhxx, GHSA-jr5f-v2jv-69x6, GHSA-43fc-jf86-j433, GHSA-3p68-rc4w-qgx5,
  GHSA-fvcv-3m26-pcqx). `npm audit --omit=dev` now exits 0.

### Tests
- Unit test suite added under `tests/unit/` (74 tests, all green) covering
  `ErrorClassifier` (10), `RetryExecutor` (5), `RateLimiter` (3), `Pipeline` (5),
  `LinkLister` (3, regression-guarding both recursion and constructor fixes),
  `WikitextParser` (6), `RipperConfig` (8 — all AJV failure modes),
  `FilterRegistry` (10), `TemplateParser` (6), `MappingEngine` (7),
  `ExternalSchemaLoader` (3), and the three internal schemas (8).

### Lane 08 — External user-supplied output schemas + mapping engine
- Added internal envelope schemas with derived TS types and AJV validators:
  `ScrapedPageSchema` (per-scraper output envelope), `RunManifestSchema`
  (per-run metadata), `TargetDefinitionSchema` (meta-schema for user target
  records). All under `src/schemas/internal/`.
- Added the `FilterRegistry` class (private constructor + statics) with
  built-in filters `trim | lower | upper | text | truncate:N | hash | join:sep |
  default:val`, plus a `register()` API for user-supplied filters.
- Added the `TemplateParser` class (`{{ field | filter | filter:arg,arg }}`
  syntax) and the `MappingEngine` class that compiles a mapping declaration
  once and projects raw scraper output into the user's shape.
- Added the `ExternalSchemaLoader` class to load + AJV-compile + cache
  user-supplied JSON Schemas from local paths or HTTP(S) URLs.
- Extended `RipperConfigSchema` so each entry under `targets.<id>` and
  `mediawiki.<id>` may declare `outputSchema` (path/URL), `mapping`
  (template record), and `onSchemaError` (`halt | skip | warn`).

### Lane 10 — Matrix CI
- Added `.github/workflows/ci.yml` running typecheck, lint, unit tests,
  target-neutrality grep, build artifact verification, and production
  `npm audit --audit-level=high` on a 2 OS × 2 Node version matrix
  (`ubuntu-latest`/`macos-latest` × Node 20/22).
- Added `.github/workflows/changelog.yml` that fails any PR to `develop` or
  `master` whose diff does not modify `CHANGELOG.md`.
