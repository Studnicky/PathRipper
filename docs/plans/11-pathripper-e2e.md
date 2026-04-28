# Lane 11 — Legacy PathRipper E2E (local only)

**Status:** Implemented (local only — CI workflows do not invoke `test:e2e`)
**Effort:** ~1.5h
**Deps:** Lanes 03, 04, 08

---

## Why this exists

This project replaces PathRipper. The e2e proves that what PathRipper used to
do, ripperoni does too — by resurrecting the original 2019 AONPRD scrape
configuration as a test fixture and running the full pipeline against the
live target. If this passes, the new project meets the old project's contract.

## Scope

- `tests/e2e/fixtures/pathripper-legacy.config.json` — faithful resurrection
  of `Studnicky/PathRipper/src/config.js`. Single crawler entry `aonprd`
  with all 41 category landing-page URLs (the Pokémon-style placeholder
  expansion of `categories[i] → https://2e.aonprd.com/<name>.aspx`),
  plus polite knobs: `rateLimitMs: 1000`, `jitterMs: 250`, `maxPages: 50`.
- `tests/e2e/aonprd.test.ts` — two cases:
  - **smoke** — crawl one category, assert ≥5 target URLs collected, all
    matching `target` and `domain` regexes.
  - **full** — crawl all 41 category seeds, gated additionally on
    `RIPPER_E2E_FULL=1`. Slower; demonstrates the multi-startUrl path.
- `package.json` script `test:e2e` (NOT included in `npm run check`).

## CI policy

**CI never runs e2e.** No `.github/workflows/*.yml` invokes `test:e2e`,
no `workflow_dispatch`, no `schedule`. Hammering `2e.aonprd.com` on every
PR or cron tick is bad citizenship and would make CI flaky on transient
network conditions.

```bash
npm run test:e2e                                          # both cases
npm run test:e2e -- --test-name-pattern='smoke'           # smoke only
npm run test:e2e -- --test-name-pattern='full'            # full crawl
```

## Target neutrality

This is the only place in the repository where real target names (AONPRD,
Pathfinder) are allowed. `scripts/check-neutrality.sh` exempts
`tests/e2e/fixtures/` and `tests/e2e/` directories. The exemption is
narrow — unit fixtures under `tests/unit/**` remain subject to the gate.

## Acceptance criteria

- [x] Fixture validates against `RIPPER_CONFIG_SCHEMA` (loaded via
      `RipperConfig.load()` succeeds)
- [x] Smoke test passes locally against the live site
- [x] Full test passes locally (slower; same `npm run test:e2e` invocation)
- [x] No CI workflow file references `test:e2e`
- [x] Neutrality script exempts `tests/e2e/`
- [x] `npm run check` does NOT invoke `test:e2e`
