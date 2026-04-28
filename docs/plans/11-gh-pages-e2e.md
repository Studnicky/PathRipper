# Lane 11 — GitHub Pages Fixture Site + E2E

**Status:** Deferred — runs **after** the first publish of the docs site to GitHub Pages
**Effort:** ~3h
**Deps:** Lanes 03, 08, 10 (tests + mapping engine + CI base)

---

## Why deferred

E2E against a deployed fixture site is only meaningful once `gh-pages` is publishing.
Per the user's direction:

> We can do the e2e after our first update publish.

This lane is queued behind the first successful `develop → master` release that
publishes `docs/` to GitHub Pages.

## Design

A dedicated `gh-pages` branch contains:

```
gh-pages/
  index.html                          (this becomes the docs site)
  assets/                             (current docs/assets contents)
  architecture.html
  roadmap.html
  fixtures/
    html/
      index.html                      list page with N <a> tags
      pages/page-1.html
      pages/page-2.html
      pages/page-3.html
    wiki/
      api.php-categorymembers.json    saved JSON for ?action=query&list=categorymembers
      api.php-revisions.json          saved JSON for ?action=query&prop=revisions
    crawl/
      start.html
      level-2/a.html ... level-2/z.html
      target/?ID=1.html ... target/?ID=N.html
    schema/
      example-page.schema.json        target-neutral example user schema
```

All fixture HTML uses placeholder content (`example.com`, `<your-target>`, lorem
ipsum). Fixtures are generated from `tests/fixtures/` so unit/integration tests
and e2e share a single source of truth.

## Build pipeline

- New script `scripts/build-fixtures.mjs` copies `tests/fixtures/` → `docs/fixtures/`
  and rewrites any localhost-relative URLs to relative paths.
- `docs/` is published via the standard "GitHub Pages from `gh-pages` branch" config.
- A new GitHub Action `pages.yml` builds and deploys on push to `master`.

## E2E test

`tests/e2e/scrape-html.test.ts`:
- Resolves the deployed URL from env var `RIPPER_E2E_BASE` (default `https://studnicky.github.io/ripper`).
- Constructs an `HtmlScraper` against a target config pointing at `${RIPPER_E2E_BASE}/fixtures/html`.
- Runs the full pipeline: scrape → mapping → user schema validation → write.
- Asserts: N expected pages, all match the fixture user schema, manifest contains all N IDs.

`tests/e2e/scrape-wiki.test.ts`:
- Uses `nock` (or a custom fetch interceptor — no new heavy dep) to map mwn API
  calls to the static JSON files under `${RIPPER_E2E_BASE}/fixtures/wiki/`.
- Runs `scrapeCategory("example-category")` and asserts pages + content.

`tests/e2e/crawl.test.ts`:
- Runs `LinkLister` against `${RIPPER_E2E_BASE}/fixtures/crawl/start.html`.
- Asserts the returned target list matches the fixture's known target URLs.

## CI workflow

`.github/workflows/e2e.yml`:
- Triggers: push to `master`, manual `workflow_dispatch`.
- Runs once (no matrix — just `ubuntu-latest` + Node 22) to keep gh-pages costs flat.
- Step 1: wait for the `pages.yml` deploy to settle (poll the URL until 200, max 60s).
- Step 2: `RIPPER_E2E_BASE=https://studnicky.github.io/ripper npm run test:e2e`.
- Failure here does NOT block `develop → master` merge (already merged at this point);
  it surfaces as a deployment alert that triggers a hotfix flow.

## Acceptance criteria

- [ ] `tests/fixtures/` directory exists with the structure above (used by integration tests too)
- [ ] `scripts/build-fixtures.mjs` produces `docs/fixtures/` deterministically
- [ ] `gh-pages.yml` deploys `docs/` (with fixtures) on push to `master`
- [ ] `tests/e2e/*.test.ts` exist and pass against `RIPPER_E2E_BASE`
- [ ] `npm run test:e2e` script exists
- [ ] No real target name appears in any fixture
- [ ] First green e2e run after first `develop → master` release
