# Lane 05 — MediaWikiScraper Batch Fix

**Status:** Ready
**Effort:** ~1.5h
**Deps:** None (but Lane 01 cleanup first is good hygiene)

---

## The problem

`mwn@1.11.0` has a transitive `axios <=0.30.3` advisory chain (5 high-severity CVEs:
GHSA-wf5p-g6vw-rhxx, GHSA-jr5f-v2jv-69x6, GHSA-43fc-jf86-j433, GHSA-3p68-rc4w-qgx5,
GHSA-fvcv-3m26-pcqx). Upgrade to `mwn@^3.0.2` is required and is breaking — fold the
API rewrite below into the same change.

`MediaWikiScraper.fetchPagesBatch()` uses `this.#bot.massQuery()` which may not exist
on `mwn@1.11.0`, and the result processing uses untyped casts:

```ts
const pages = await this.#bot.massQuery({ ... });       // method existence unverified
pages.flatMap((page: Record<string, unknown>) => {       // untyped
  const q = page as { query?: { ... } };                 // cast
```

`fetchPage()` uses `this.#bot.read(title)` with a similar untyped result cast:

```ts
const page = await this.#bot.read(title);
const wikitext = (page as { revisions?: Array<{ content?: string }> })
  .revisions?.[0]?.content ?? '';
```

Both need to be verified against actual `mwn@1.11.0` API surface and rewritten
to use documented methods with proper result handling.

## Research step (do first)

Check `mwn@1.11.0` API:
```bash
node -e "import('mwn').then(m => console.log(Object.keys(new m.mwn())))" 2>/dev/null
```

Or read `node_modules/mwn/build/index.d.ts` for the actual method signatures.

Known-good `mwn` methods for wikitext fetching:
- `bot.read(title, { prop: 'revisions', rvprop: 'content' })` — single page
- `bot.read(titles[])` — array batch (returns array of page objects)
- `bot.continuedQueryGen(params)` — paginated query generator (already used in `fetchCategory`)

## Fix

### `fetchPage`
Verify the `read()` return shape from types and rewrite without cast:
```ts
const result = await this.#bot.read(title, { prop: 'revisions', rvprop: 'content' });
// access via documented shape, not `as { revisions? }`
```

### `fetchPagesBatch`
Replace `massQuery` with `bot.read(titles)` (array overload):
```ts
const results = await this.#bot.read(titles.slice(i, i + BATCH));
// mwn.read() with an array returns an array of ApiPage objects
```

If `mwn` doesn't have a typed `ApiPage` export, declare a minimal interface locally
rather than casting through `Record<string, unknown>`.

## Acceptance criteria

- [ ] `mwn` upgraded to `^3.0.2` (clears axios advisory chain)
- [ ] `npm audit --omit=dev` exits 0
- [ ] Zero `as { ... }` casts or `Record<string, unknown>` in `MediaWikiScraper.ts`
- [ ] `fetchPage(title)` returns correct wikitext for a real page (manual smoke test
      against the user's own configured wiki target — never named in this repo)
- [ ] `fetchPagesBatch([...])` with two valid titles returns two pages with non-empty wikitext
- [ ] `scrapeCategory('<example-category>')` completes without error against the user's wiki target
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
