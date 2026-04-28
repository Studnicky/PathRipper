# Lane 09 — CHANGELOG, Husky, Branch Flow

**Status:** Ready
**Effort:** ~1h
**Deps:** None

---

## What's missing

- No `CHANGELOG.md` (mandatory per § / ↻).
- No `.husky/` — commits and pushes have no local gate.
- No `develop` branch — `master` is currently the only branch, with all WIP uncommitted directly on top of it. Per ↻, both `master` and `develop` are protected and feature branches PR into `develop`.
- No PR template at `.github/pull_request_template.md`.
- No `.gitignore` entries for the things this lane introduces (verify and extend).

## Tasks

### 1. `CHANGELOG.md`

Conventional Keep-a-Changelog format. Initial entry:

```markdown
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- TypeScript rewrite of the PathRipper pipeline: `Pipeline`, `LinkLister`, `HtmlScraper`,
  `MediaWikiScraper`, `WikitextParser`, `RetryExecutor`, `RateLimiter`, `ErrorClassifier`,
  `Logger`.
- CLI: `ripperoni scrape-html`, `ripperoni scrape-wiki`, `ripperoni crawl`.
- Configurable target system (no target hardcoded in source).

### Changed
- Project renamed to `ripperoni`; PathRipper repository remains as historical reference.
```

Each subsequent feature/release/hotfix MUST add an entry before merge.

### 2. `.husky/`

Two hooks (Husky v9 format — single executable file, no shebang block):

```
.husky/pre-commit   →  npm run lint
.husky/pre-push     →  npm run check && scripts/check-neutrality.sh
```

`scripts/check-neutrality.sh` greps for the banned target names listed in Lane 07
and exits non-zero if any are present outside the user's local `ripperoni.config.json`
(which is gitignored).

Add `husky` to `devDependencies` and a `prepare: "husky"` npm script.

### 3. Branch flow

- Create `develop` from `master` HEAD.
- Protect both branches (manual GitHub setting, document in `docs/plans/09-...md`).
- Current work continues on `feature/ripper-foundation`.
- PR target: `develop`. Squash-merge.
- Releases: `develop` → `release/x.y.z` → PR into `master` → tag → back-merge to `develop`.
- This lane only bootstraps `develop`; release flow is documented but not exercised here.

### 4. PR template

`.github/pull_request_template.md` matches the `<pr-template>` block in the user's
global CLAUDE.md (Summary / Type of Change / Testing / Checklist / Related Issues
/ blessing line — blessing rendered, never the literal `<✎ blessing>` token).

### 5. `.gitignore` additions

Verify present, add if missing:
```
node_modules/
dist/
coverage/
output/
ripperoni.config.json       # user's local config — never committed
*.log
.DS_Store
```

Note: `ripperoni.config.example.json` IS committed; the unprefixed
`ripperoni.config.json` (the user's actual config) is not.

## Acceptance criteria

- [ ] `CHANGELOG.md` exists at repo root with `## [Unreleased]` block
- [ ] `.husky/pre-commit` and `.husky/pre-push` exist and are executable
- [ ] `npm run prepare` installs hooks without error
- [ ] `develop` branch exists locally and (after first push) on origin
- [ ] `.github/pull_request_template.md` exists with the required sections
- [ ] `.gitignore` covers `output/`, `ripperoni.config.json`, `dist/`, `coverage/`
- [ ] Push to a feature branch with a banned target name in any file → pre-push fails
