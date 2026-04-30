# Lane 10 — Matrix CI

**Status:** Ready (depends on Lane 03 for tests to actually run)
**Effort:** ~2h
**Deps:** Lane 03 (tests must exist), Lane 09 (PR template + branch flow)

---

## Goal

Every PR runs the full check suite on a matrix of supported environments. Merge
gated on green CI per § / ↻.

## Workflow files

### `.github/workflows/ci.yml`

Triggers: pull request to `develop` or `master`, push to `develop`/`master`.

Matrix:
- `os`: `ubuntu-latest`, `macos-latest`
- `node`: `20.x`, `22.x`

Jobs (each runs the matrix):

1. **install** — `npm ci`, cache `~/.npm` keyed on `package-lock.json`
2. **typecheck** — `npm run typecheck`
3. **lint** — `npm run lint`
4. **test:unit** — `npm run test:unit`
5. **test:integration** — `npm run test:integration` (uses local fixture HTTP server, no network)
6. **neutrality** — `scripts/check-neutrality.sh` (no real target names anywhere)
7. **build** — `npm run build` and assert `dist/cli/cli.js` exists

### `.github/workflows/changelog.yml`

Triggers: pull request to `develop` or `master`.

- Asserts `CHANGELOG.md` was modified in the PR diff (skip on `dependabot/*` and `chore/*` branches if needed — start strict).
- Failure → "Add a CHANGELOG entry under `## [Unreleased]`".

### `.github/workflows/codeql.yml` (optional, recommended)

Standard GitHub CodeQL action for TypeScript — defense-in-depth supply-chain visibility.

## Branch protection (manual, document in this lane)

- `master`: require PR, require all `ci.yml` jobs to pass, require linear history, restrict pushes.
- `develop`: same minus linear history.
- Both: require CHANGELOG check.

## E2E job (deferred to Lane 11)

A separate `e2e.yml` will run after the gh-pages fixture site exists. It is not part
of the default CI gate so a fresh clone with no gh-pages publish doesn't fail.

## Acceptance criteria

- [ ] `.github/workflows/ci.yml` runs on PR + push to `master`/`develop`
- [ ] Matrix is 2 OS × 2 Node versions = 4 jobs per workflow run
- [ ] Each job runs typecheck, lint, unit tests, integration tests, neutrality grep, build
- [ ] `.github/workflows/changelog.yml` enforces a CHANGELOG diff on every PR
- [ ] First green run on `feature/ripper-foundation` after this lane lands
- [ ] Branch protection rules are documented in this file with screenshots / settings (manual step)
