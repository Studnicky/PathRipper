# Ripperoni — Current State

Last updated: 2026-04-27

---

## What compiles and lints clean

- `npm run typecheck` — passes
- `npm run lint` — passes
- All 20 source files present with correct exports

## What does NOT work yet

### 1. `LinkLister` constructor bug — wrong field assigned

```
src/crawlers/LinkLister.ts:48  this.#target   = config.delimiter;  // BUG: assigns delimiter to target
src/crawlers/LinkLister.ts:49  this.#delimiter = config.delimiter;  // correct
src/crawlers/LinkLister.ts:54  void config.target; // suppression
src/crawlers/LinkLister.ts:55  this.#target = config.target;       // fixes it but via dead code pattern
```

`this.#target` is assigned twice. The `void config.target` is a lint suppression hack
from development. Runtime is correct, code is wrong. → **Lane 01**

### 2. CLI uses dynamic imports — violates project standards

All three CLI commands use `await import(...)` inside action handlers, plus the default
config path is `./ripper.config.json` while README/docs reference `./ripperoni.config.json`
(drift). → **Lane 02** (imports), **Lane 07** (path alignment)

### 3. Zero tests

`tests/unit/` and `tests/integration/` are both empty. → **Lane 03**

### 4. `RipperConfig` has no runtime validation

`return raw as RipperConfigInterface` with no schema check. Wrong config silently
succeeds, crashes downstream. → **Lane 04**

### 5. `MediaWikiScraper.fetchPagesBatch` uses untyped mwn internals

`massQuery` may not exist on `mwn@1.11.0`; result processing leans on `Record<string, unknown>`
casts. → **Lane 05**

### 6. No `ripperoni.config.example.json`

README and CLI reference it, repo doesn't ship one. → **Lane 06**

### 7. Real target names scattered across source, docs, and the existing example plan

`bulbapedia`, `aonprd`, `serebii`, plus Pokémon-specific roadmap entries appear in
`README.md`, `docs/index.html`, `docs/architecture.html`, `docs/roadmap.html`,
`docs/plans/05-...md`, and `docs/plans/06-...md`. Ripperoni is target-neutral by
design — these belong only in the user's own (gitignored) config. → **Lane 07**

### 8. No internal schemas or mapping engine

Internal types are hand-written interfaces; there is no JSON-Schema source of truth
and no AJV validation of user-supplied output schemas or mapping declarations. The
project cannot promise schema-shaped output. → **Lane 08**

### 9. No CHANGELOG, no husky, no `develop` branch, no PR template

`master` has no protection layer in this repo's structure: no commit hooks, no
push hooks, no separation between trunk and integration branches, no PR scaffolding.
→ **Lane 09**

### 10. No CI workflows

No `.github/workflows/` directory exists. Nothing runs on PR or push. No matrix
across Node / OS. → **Lane 10**

### 11. No e2e against deployed fixtures

Deferred until the gh-pages docs site publishes for the first time. → **Lane 11**

---

## Dependency map

```
01 (LinkLister bug)         — unblocked
02 (CLI static imports)     — unblocked
04 (config validation)      — unblocked
05 (MediaWiki batch)        — unblocked
06 (example config)         — unblocked
07 (target neutrality)      — unblocked
09 (CHANGELOG/husky/flow)   — unblocked

03 (tests)                  — needs 01 + 02
08 (schemas/mapping)        — needs 04 + 07
10 (matrix CI)              — needs 03 + 09
11 (gh-pages e2e)           — needs 03 + 08 + 10 + first publish
```

Parallel batch A: 01, 02, 04, 05, 06, 07, 09 (no source overlap among them).
Sequential: 03 → 08 → 10. Deferred: 11.
