# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Plugin system — user-space parse tasks via TaskRegistry

ripperoni now has a plugin task registry. Instead of writing output from raw
wikitext in the CLI, you can register a named parse task that runs in the
pipeline before the file is written.

**How to write a plugin:**

1. Create a `.js` file anywhere outside `src/` (convention: `plugins/<target>/`).
2. Import `TaskRegistry` from `dist/registry/TaskRegistry.js` and `WikitextParser`
   from `dist/scrapers/WikitextParser.js`.
3. Register your task under the name `<targetId>:parse`:
   ```js
   import { TaskRegistry } from '../../dist/registry/TaskRegistry.js';
   const task = async (next, state) => {
     // read state.page.wikitext, write to state.output
     await next();
   };
   TaskRegistry.register('mytarget:parse', task);
   ```
4. Point the config at your file:
   ```json
   { "mediawiki": { "mytarget": { "tasks": ["./plugins/mytarget/parse.task.js"] } } }
   ```

The CLI loads each `tasks` entry at startup (side-effect import), then for
each page it runs `<targetId>:parse` through the pipeline before writing.
If the task sets `state.output`, that object is written to the JSON file.
If it doesn't, the CLI falls back to raw `WikitextParser.parse` output.

**Note on `wtf_wikipedia` and non-standard infoboxes:** `wtf_wikipedia`
only recognizes standard Wikipedia infobox templates. Non-standard infoboxes
(e.g. `{{MastersInfobox`) are parsed as generic templates, accessible via
`doc.templates()`. Find your template by checking the normalized
`template` field on `.json()` (lowercased template name, no spaces).

### Error handling — structured, named errors throughout

All errors thrown from ripperoni are now typed and carry structured metadata.
The project ports `BaseError` from `@noocodec/cogitator`: every error has a
`code` (derived from the class name), a `retryable` flag, an optional `cause`
chain, and a `metadata` bag. `BaseError.format(unknown)` serialises any error
consistently. Named error classes: `RipperConfigError` for bad config files,
`HttpError` (marks 5xx/429 as retryable, 4xx as not), `MappingError` for
template/filter problems, and `ExternalSchemaError` for schema load failures.

### Clean module boundaries — everything owned by a class

Free-floating helper functions removed from the codebase. All logic now
lives on the class that owns it: `Logger.write` and `Logger.currentLevel`
are private statics on `Logger`; `ErrorClassifier.retryAfterMs` is a
private static on `ErrorClassifier`; `RetryExecutor.computeDelay` on
`RetryExecutor`; `LinkLister.extractLinks` on `LinkLister`;
`MediaWikiScraper.wikitextOf` on `MediaWikiScraper`; the cheerio/string
helpers on `FilterRegistry`; `MappingEngine.lookupField` on `MappingEngine`.
A new `Time.sleep(ms)` static absorbs the duplicated `sleep` helper that was
scattered across `RateLimiter` and `RetryExecutor`.

### Schema validators are first-class domain objects

Each JSON Schema now exposes a companion `*Validator` class (`RipperConfigValidator`,
`ScrapedPageValidator`, `RunManifestValidator`, `TargetDefinitionValidator`)
with `validate(data)` and `formatErrors()` statics. The AJV instance and compiled
validator are encapsulated; callers can never access AJV internals directly.

### Simplified public API — no barrel indirection

Flat barrel re-export files replaced. The package exports map now points directly
at class source files for all standalone classes, and at two logical groups:
`ripperoni/errors` for all error types, `ripperoni/schemas` for all schema
validators and derived types. This removes a layer of indirection that made it
hard to trace what a symbol actually was.

### enginseer CLI available locally without a dependency

`scripts/enginseer.sh` provides access to `@noocodec/enginseer` (dep-graph,
symbols, compact, etc.) via `npx` against the local monorepo — no entry in
`package.json`, no lock-file noise. `.orchestration/` outputs are gitignored.

### Lane 09 — Native git hooks (replaces husky)
- Removed `husky` devDependency entirely. Source-of-truth hooks now live at
  `hooks/pre-commit` and `hooks/pre-push` (committed). The `prepare` npm
  script runs `scripts/install-hooks.sh`, which copies them into git's
  default `.git/hooks/` directory on every clone's first `npm install`.
- `git config core.hooksPath` is unset — hooks live where git natively
  looks for them. No vendored runtime, no symlinks, no third-party hook
  manager. The install script is idempotent and silently no-ops outside
  a git working tree.

### Lane 11 — Legacy PathRipper E2E (local only)
- Resurrected the original 2019 PathRipper Pathfinder/AONPRD scrape
  configuration as `tests/e2e/fixtures/pathripper-legacy.config.json`. The
  fixture is the canonical proof that this project replaces PathRipper —
  what PathRipper ripped, ripperoni rips.
- Added `tests/e2e/aonprd.test.ts` with two cases (smoke = one category,
  full = all 41 category seeds).
- Added `npm run test:e2e` script. Not invoked by `npm run check`.
  Not referenced by any `.github/workflows/*.yml` — CI never runs e2e.
- Narrowed `npm run test` and `npm run check` to `tests/unit/**` so the
  default test run never picks up e2e by accident.
- `scripts/check-neutrality.sh` exempts `tests/e2e/` so the legacy AONPRD
  config can live in the repo without violating the gate (unit fixtures
  under `tests/unit/**` remain subject to the gate).

### Configuration shape changes (BREAKING within Unreleased)
- `crawlers.<id>.startUrl` removed; replaced by `crawlers.<id>.startUrls`
  (`string[]`, `minItems: 1`). Single-seed users pass a one-element array.
  Users who want category-style expansion build the URL list themselves
  before passing it in. The legacy 41-category PathRipper config maps
  natively into this shape.
- `LinkLister.buildList(startUrl)` is now `buildList(startUrls)`.
- `crawlers.<id>` gains `jitterMs` and `maxPages`. `maxPages` bounds the
  total target URLs collected per `buildList()` call (useful for capped
  e2e runs and runaway-prevention).
- `targets.<id>` and `mediawiki.<id>` gain `jitterMs`.

### Timing / jitter — universal across HTTP-bearing components
- `RateLimiter` accepts `jitterMs?: number` in its config. When > 0 the
  scheduled fn waits a random `[0, jitterMs)` ms inside the rate-limited
  slot, producing variance on every normal request (not just retries).
  Default 0 — backwards-compatible behavior preserved.
- `HtmlScraper`, `MediaWikiScraper`, and `LinkLister` all read `jitterMs`
  from their target config and pass it through to their internal
  `RateLimiter` — universal coverage, single mechanism.
- `RetryExecutor` continues to apply ±10% jitter on retry backoff (was
  already there) and to honor `Retry-After` headers via `ErrorClassifier`.

### CLI
- `ripperoni crawl` now takes `--starts <urls...>` (was `--start <url>`).
- `ripperoni crawl` gains `--jitter <ms>` and `--max <n>` flags.

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
