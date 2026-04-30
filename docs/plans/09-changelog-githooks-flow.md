# Lane 09 — CHANGELOG, Native Git Hooks, Branch Flow

**Status:** Implemented
**Effort:** ~1h
**Deps:** None

---

## What's missing

- No `CHANGELOG.md` (mandatory per § / ↻).
- No git hook gates — commits and pushes have no local enforcement.
- No `develop` branch — `master` is the only branch. Per ↻, both `master` and
  `develop` are protected and feature branches PR into `develop`.
- No PR template at `.github/pull_request_template.md`.
- No `.gitignore` entries for the things this lane introduces.

## Tasks

### 1. `CHANGELOG.md`

Keep-a-Changelog format with an `## [Unreleased]` block. Every PR adds an
entry under Unreleased; the `.github/workflows/changelog.yml` enforces that.

### 2. Native git hooks (no husky)

Source-of-truth tracked at `hooks/`:

```
hooks/pre-commit   →  npm run lint
hooks/pre-push     →  npm run check && scripts/check-neutrality.sh
```

Both files start with `#!/usr/bin/env bash` and `set -euo pipefail`.

Install mechanism: `scripts/install-hooks.sh` copies `hooks/*` into git's
default `.git/hooks/` directory and makes them executable. Wired into the
npm `prepare` lifecycle (`scripts.prepare = "bash scripts/install-hooks.sh"`)
so every fresh clone gets hooks installed on first `npm install`.

The script silently exits 0 outside a git working tree so the package can
still be installed as a dependency from npm without errors.

No `husky` devDependency. No `core.hooksPath` override. Hooks live where git
defaults to looking for them.

### 3. Branch flow

- Create `develop` locally from `master` HEAD.
- Protect both branches (manual GitHub setting after first push).
- Feature branches PR into `develop`. Squash-merge.
- Releases: `develop` → `release/x.y.z` → PR into `master` → tag → back-merge
  to `develop`.

### 4. PR template

`.github/pull_request_template.md` matches the `<pr-template>` block in the
global CLAUDE.md (Summary / Type / Testing / Checklist / Related Issues).

### 5. `.gitignore` additions

`dist/`, `output/`, `ripperoni.config*.json` (with an explicit allow-list for
`ripperoni.config.example.json`), `.claude/`, `.enginseer/`, `.DS_Store`.

## Acceptance criteria

- [x] `CHANGELOG.md` exists at repo root with `## [Unreleased]` block
- [x] `hooks/pre-commit` and `hooks/pre-push` exist and are executable
- [x] `scripts/install-hooks.sh` copies hooks into `.git/hooks/`
- [x] `npm run prepare` installs hooks without error and is idempotent
- [x] No `husky` in package.json, node_modules, or hook chain
- [x] `develop` branch exists locally
- [x] `.github/pull_request_template.md` exists with the required sections
- [x] `.gitignore` covers `output/`, `dist/`, `ripperoni.config*.json` (except example)
- [x] `git config core.hooksPath` is empty (default `.git/hooks/`)
