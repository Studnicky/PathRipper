# Ripperoni — Implementation Lanes

Current state: [`00-current-state.md`](00-current-state.md)

## Can start now (no blocking deps)

| Lane | File | What |
|------|------|------|
| 01 | [linklister-bug](01-linklister-bug.md) | Fix double-assignment constructor bug (~15 min) |
| 02 | [cli-static-imports](02-cli-static-imports.md) | Remove all dynamic imports from CLI (~30 min) |
| 04 | [config-validation](04-config-validation.md) | AJV runtime validation on config load (~1h) |
| 05 | [mediawiki-batch](05-mediawiki-batch.md) | Fix unverified mwn API usage in batch fetch (~1.5h) |
| 06 | [example-config-cleanup](06-example-config-cleanup.md) | Target-neutral example config + repo hygiene (~20 min) |
| 07 | [target-neutrality](07-target-neutrality.md) | Scrub all real target names from src/docs/README (~45 min) |
| 09 | [changelog-husky-flow](09-changelog-husky-flow.md) | CHANGELOG, husky, develop branch, PR template (~1h) |

## Blocked by earlier lanes

| Lane | File | Blocked by |
|------|------|------------|
| 03 | [tests](03-tests.md) | Lanes 01 + 02 (test correct code) |
| 08 | [external-schemas-and-mapping](08-external-schemas-and-mapping.md) | Lanes 04, 07 (AJV wiring + neutrality) |
| 10 | [matrix-ci](10-matrix-ci.md) | Lanes 03, 09 (tests + branch flow) |
| 11 | [pathripper-e2e](11-pathripper-e2e.md) | Lanes 03, 04, 08 — **local only, never CI** |

## Completion gate

The project is **trustworthy** when lanes 01–10 are done and `npm run check` exits 0
in CI on a matrix of supported environments. Lane 11 (PathRipper e2e) is local-only
and runs intentionally with `npm run test:e2e` — no CI workflow invokes it.

## Order of execution (this branch: `feature/ripper-foundation`)

Parallel batch A (independent file sets):
- 01 — `src/crawlers/LinkLister.ts`
- 02 — `src/cli/cli.ts`
- 04 — `src/config/RipperConfig.ts` + new `src/schemas/internal/RipperConfigSchema.ts`
- 05 — `src/scrapers/MediaWikiScraper.ts`
- 06 — `ripperoni.config.example.json` + `.gitignore`
- 07 — `README.md`, `docs/*.html` (no source overlap with above)
- 09 — `CHANGELOG.md`, `.husky/`, `.github/pull_request_template.md`, `package.json`

Sequential after batch A:
- 03 — tests (depends on 01, 02 fixed)
- 08 — schemas + mapping engine (depends on 04, 07)
- 10 — matrix CI (depends on 03, 09)

Local-only (not CI):
- 11 — PathRipper AONPRD e2e (`npm run test:e2e`; no CI workflow invokes it)
