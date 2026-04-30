# Lane 12 — Config-driven pipelines + scraper-level cache

**Status:** Planned
**Effort:** ~6h
**Deps:** Lane 03 (tests), Lane 04 (config validation), Lane 11 (e2e). Replaces the implicit task-injection in `ScrapeOrchestrator`.

---

## Why this exists

Today the orchestrator is the conductor: it owns where to fetch, what plugin runs, where JSON is written, and the order of those operations. Plugins only contribute the parse step. This couples three concerns that should be independent:

1. **Network fetch** — currently hard-coded, no caching, slams source servers on every iteration.
2. **Plugin parse** — the only step the user controls today.
3. **Output write** — silently appended by the orchestrator inside its own loop.

Iterating on a plugin (e.g., fixing the `monster.ts` strike parser the audit surfaced) requires re-fetching every page on every run. That's wasteful, slow, and a bad citizen of the source servers.

This redesign:

- Moves every step into `TaskRegistry`. Built-in tasks (`html:fetch`, `wiki:fetch`, `json:write`, `html:write-raw`, `jsonl:append`, `validate:schema`) register at module load alongside user plugins.
- Adds a config-declared `pipeline: string[]` per target. The orchestrator runs `Pipeline` over the array verbatim — no implicit prepend/append.
- Adds a content-addressed file cache to both `HtmlScraper` and `MediaWikiScraper`, configurable per-target (`cache: { dir, mode, ttlMs? }`).

Two-pass workflows fall out for free as composition of these primitives:

- **Snapshot only**: `pipeline: ["html:fetch", "html:write-raw"]` + `cache.mode: 'write-only'`.
- **Parse-iterate (zero network)**: `pipeline: ["html:fetch", "aonprd:parse", "json:write"]` + `cache.mode: 'read-only'`. Cache miss raises `CacheMissError` and that page goes into `failures.json`.
- **Production**: `pipeline: ["html:fetch", "aonprd:parse", "json:write"]` + `cache.mode: 'read-write'` — populates the cache incrementally, and re-runs are mostly cache hits.

Symmetric for the wiki side.

## Scope

### A. Built-in task module

`src/registry/builtinTasks.ts` — registers six tasks unconditionally on import. `Orchestrator` imports it once, ensuring registration order is deterministic and built-ins always exist before user plugins load.

| Task name        | Reads from state          | Writes to state          | Purpose                                                        |
|------------------|---------------------------|--------------------------|----------------------------------------------------------------|
| `html:fetch`     | `state.page.url`          | `state.page.html` + url  | HtmlScraper.fetchPage; cache-aware                             |
| `wiki:fetch`     | `state.page.title`        | `state.page.wikitext`    | MediaWikiScraper.fetchPage (single); cache-aware               |
| `html:write-raw` | `state.page.html`         | side-effect              | Writes raw body to `<outDir>/<target>/raw/<slug>.html`         |
| `wiki:write-raw` | `state.page.wikitext`     | side-effect              | Writes raw wikitext to `<outDir>/<target>/raw/<slug>.txt`      |
| `json:write`     | `state.output`            | side-effect              | Writes JSON to `<outDir>/<target>/<slug>.json`                 |
| `jsonl:append`   | `state.output`            | side-effect              | Appends to `<outDir>/<target>/all.jsonl`                       |
| `validate:schema`| `state.output`            | throws on failure        | Runs external schema if `outputSchema` config field is set     |

The orchestrator no longer injects `json:write` — if the user wants writes, they list it. This eliminates the today's silent-append-of-write-task code in `ScrapeOrchestrator.runPipeline`.

### B. ScraperCache

`src/modules/cache/ScraperCache.ts` — pure file IO, no HTTP knowledge.

```ts
type ScraperCacheMode = 'read-write' | 'read-only' | 'write-only' | 'off';

interface ScraperCacheConfig {
  dir:    string;
  mode:   ScraperCacheMode;
  ttlMs?: number;          // refetch if entry older than ttl
}

class ScraperCache {
  static create(config: ScraperCacheConfig): ScraperCache;
  has(key: string): Promise<boolean>;
  read(key: string): Promise<{ body: string; meta: CacheMeta } | null>;
  write(key: string, body: string, meta: CacheMeta): Promise<void>;
  delete(key: string): Promise<void>;
  /** sha1(method + '\n' + url + '\n' + JSON.stringify(sortedHeaders)) */
  static keyFor(req: { method: string; url: string; headers?: Record<string,string> }): string;
}

interface CacheMeta {
  url:       string;
  method:    string;
  fetchedAt: string;     // ISO-8601
  status:    number;
  headers?:  Record<string, string>;
}
```

Storage layout: `<dir>/<key.slice(0,2)>/<key.slice(2)>.body` + sibling `.meta.json`. Sharded so directories stay small with 50k+ entries.

### C. HtmlScraper integration

`HtmlScraper.create({ ...existing, cache?: ScraperCacheConfig })`. When cache is configured, every `fetchPage` call:

1. Compute key via `ScraperCache.keyFor`.
2. If `mode in {read-write, read-only}` and cache hit (and within ttl): return cached body. **No rate-limit consumed.**
3. If `mode === 'read-only'` and miss: throw `CacheMissError` (typed; not retryable; fed into the failures manifest by the orchestrator).
4. Otherwise fetch through the rate limiter as today, and on success (status 200) write to cache.
5. Non-2xx responses do NOT poison the cache.

### D. MediaWikiScraper integration

Same shape but keyed on the API call, not the URL — `keyFor({ method:'GET', url: apiUrl, headers: { ...query-params-as-canonical-string } })`. Batched requests (`fetchPagesBatch`) decompose into per-title cache lookups: titles already in the cache are answered locally; remaining titles get rolled into a smaller API call.

### E. Schema changes

`src/schemas/internal/RipperConfigSchema.ts`:

- Per-target (and per-mediawiki) entries: add `pipeline: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1 }`. Make it required.
- Add `cache: { type: 'object', additionalProperties: false, properties: { dir, mode (enum), ttlMs } }`. Optional.
- **Remove `tasks: string[]`** entirely. No backwards compatibility (per project convention — config migration is git/infra, not code).

### F. Orchestrator collapse

`ScrapeOrchestrator.scrapeHtml`:

1. Validate `targets[opts.target]` exists. (Existing logic.)
2. Eagerly import `builtinTasks` so built-ins register.
3. For every `pipeline` entry that is NOT a built-in task name, derive a plugin file path via `<target>:<verb>` → `./plugins/<target>/<verb>.task.js` convention, and call `TaskRegistry.load`. (Or: keep the explicit `tasks: string[]` legacy by deriving plugin paths from pipeline entries that look like `<target>:<verb>` and exist on disk; built-ins like `html:fetch` short-circuit the load.)
4. Build `HtmlScraper` with the target's `cache` config.
5. Resolve page list (single path → wrap; today's `--paths` flow).
6. For each page: build `Pipeline` from `pipeline[]`, execute, route exceptions to a `failures.json` writer. The orchestrator no longer appends a write task.

`scrapeWiki` mirrors this but uses `wiki:fetch` and the existing 4-mode page resolution (resume-failures / single category / configured categories / all-pages).

The orchestrator stops being a pipeline author. It becomes a pipeline runner.

### G. State extension

`PipelineStateInterface` gains an optional `context` field:

```ts
interface PipelineContextInterface {
  target: string;
  outDir: string;
  scraper?: HtmlScraper | MediaWikiScraper;
  config:  TargetConfig;
}
```

Built-in tasks read from `state.context` (set by the orchestrator before pipeline execution). User plugins are unaffected — they continue using `state.page` / `state.output`.

## Implementation order

1. **`ScraperCache`** + unit tests (hit/miss/ttl/modes/sharding/key derivation).
2. **`HtmlScraper.cache`** integration + unit tests (mock fetch).
3. **`MediaWikiScraper.cache`** integration + unit tests.
4. **`builtinTasks.ts`** — six tasks + per-task unit tests (each in isolation, with a fake scraper for fetch tasks).
5. **Schema rewrite** — add `pipeline` + `cache`, remove `tasks`. Update fixtures (`tests/e2e/fixtures/pathripper-legacy.config.json`, `ripperoni.config.example.json`).
6. **Orchestrator rewrite** — both methods. Delete the implicit `addTask(write …)` block.
7. **Update existing e2e** — `tests/e2e/aonprd-plugin.test.ts` uses `cache.mode: 'read-write'` against a temp dir; second run is cache-only.
8. **Add snapshot e2e** — `tests/e2e/aonprd-snapshot.test.ts` runs `pipeline: ["html:fetch", "html:write-raw"]` to a temp dir, then a second sub-test runs `pipeline: ["html:fetch", "aonprd:parse", "json:write"]` with `cache.mode: 'read-only'` against the same dir, asserting zero network on the second pass.
9. **Update bulbapedia config** to use `pipeline`.

## CI policy

Unchanged from Lane 11 — CI never runs `test:e2e`. The new snapshot e2e test continues to run network-positive on first invocation; second invocation against the populated cache becomes a deterministic, network-free run that's still gated to local-only. A future lane could move that second invocation into the unit suite (committed snapshot directory) without touching this design.

## Acceptance criteria

- [ ] `pipeline: string[]` is required on every targets/mediawiki config entry.
- [ ] Six built-in tasks live in `src/registry/builtinTasks.ts` and self-register on import.
- [ ] `ScraperCache` supports four modes (read-write, read-only, write-only, off), with optional TTL.
- [ ] `HtmlScraper.cache` and `MediaWikiScraper.cache` consult the cache before consuming the rate limiter.
- [ ] `read-only` cache miss raises `CacheMissError`, the orchestrator catches it, and the URL is written to `failures.json`.
- [ ] `ScrapeOrchestrator.runPipeline` no longer contains an `addTask(async ... writeFile ...)` block; that responsibility moves entirely into `json:write`.
- [ ] `npm run check` passes (typecheck + lint + 192+ unit tests).
- [ ] `npm run test:e2e` smoke + plugin-smoke + snapshot e2e all green locally.
- [ ] No `tasks: string[]` field remains anywhere in source, schemas, or fixtures.

## Out of scope (roadmap notes for future lanes)

- **Parser bug fixes** — audit-surfaced bugs in `monster.ts` (strike parsing, recall knowledge), `character.ts` (modern ancestry `<h2>` mechanics). Easier to fix once iteration is network-free; tracked as a follow-up lane.
- **HTTP-level conditional GET** — `If-Modified-Since` / `ETag` revalidation. Future lane.
- **Per-header cache-key variation** — current `keyFor` hashes a *curated subset* of headers (Accept, Accept-Language only — User-Agent excluded since it should never vary at runtime within a target). If we ever need full header-dependent representations we'd add it then. Future lane.
- **Distributed cache backends** — S3, Redis. Filesystem only for now. Future lane.
- **Streaming bodies** — current store reads/writes full bodies. Future lane if we hit memory pressure on huge pages.

## Section G — Unified content store + LinkLister as a task

The "scraper cache" and the LinkLister's "visited URL" concept are the same idea: "have I already retrieved this URL's body?". This lane unifies them and makes link-listing a first-class pipeline task.

### G1. ContentStore = the cache

`ScraperCache` IS the content store. No rename, no second module. It's used by every component that fetches a body:

- `HtmlScraper.fetchPage` — already wired in this lane.
- `MediaWikiScraper.fetchPagesBatch` — already wired in this lane.
- `LinkLister.fetchPage` — newly wired in this lane. The LinkLister keeps its in-process `visited: Set<string>` for fast intra-run dedup, but the body-fetch path now consults the shared `ScraperCache` first.

### G2. Single store instance per target

The orchestrator constructs ONE `ScraperCache` instance per target run and passes it to every fetcher:

```ts
const store   = ScraperCache.create(target.cache);
const lister  = LinkLister.create({  ...listerCfg,  cache: store });
const scraper = HtmlScraper.create({ ...scraperCfg, cache: store });
```

A URL fetched by the lister becomes a free hit for the scraper later in the same run (no warm-the-cache step), and re-runs hit the store for both components.

### G3. Cache-key consistency

`keyFor(req)` hashes `(method, url, sortedHeaders)`. To guarantee that the lister and the scraper produce the same key for the same URL, **the orchestrator passes the same `headers` object to both**. Headers/User-Agent must not vary at runtime within a target — that's a stable per-target identity, not a per-request decision. (Subset of headers in the hash is a future-lane concern.)

### G4. LinkLister becomes a registered task: `crawl:list-targets`

LinkLister stops being orchestrator-special. It's a built-in task added to the registry alongside `html:fetch`, etc.:

| Task name             | Reads from state          | Writes to state            | Purpose                                                   |
|-----------------------|---------------------------|----------------------------|-----------------------------------------------------------|
| `crawl:list-targets`  | `state.context.config.crawler` (seeds + regexes) | `state.context.targets[]` (discovered URL list) | Walks seed pages, BFS to maxPages, returns target URLs |

The crawl step becomes part of the declarative pipeline:

```jsonc
{
  "pipeline": [
    "crawl:list-targets",   // discovers URLs into state.context.targets
    "html:fetch",            // fetches each
    "aonprd:parse",          // user plugin
    "json:write"             // emits JSON
  ]
}
```

The orchestrator iterates `state.context.targets` and runs the rest of the pipeline per URL. If `crawl:list-targets` is absent from the pipeline, the orchestrator uses the explicit `paths` argument as today (single-page or hand-curated lists). Both modes stay supported.

### G5. Shared config field

A target's `cache: { ... }` config now applies to ALL fetchers used for that target. Same shape, same instance.

### G6. Acceptance additions

- [ ] `LinkLister` accepts a REQUIRED `cache: ScraperCache` constructor field; `fetchPage` consults it before issuing network requests. Every existing LinkLister call site is updated; no backwards compat.
- [ ] `crawl:list-targets` is registered as a built-in task and produces `state.context.targets[]`.
- [ ] An e2e test demonstrates: run 1 with `cache.mode: 'read-write'` populates from network; run 2 with `cache.mode: 'read-only'` against the same temp dir does crawl + scrape with **zero network calls**.

## Section H — Unified config surface (adapter pattern)

Today the schema duplicates the same concept under two names because the underlying adapter differs:

- `targets.<key>.maxPages` (HTML adapter — caps how many pages are scraped)
- `mediawiki.<key>.allPagesLimit` (Wiki adapter — caps the all-pages enumeration)
- `crawlers.<key>.maxPages` (Crawler adapter — caps BFS depth)

Three names, one concept: **"how many pages does this target cap at?"**. That's a config leak — the adapter's internal terminology bled into the user-facing schema.

### H1. Unified field

A single field at the per-target level: `maxPages: { type: 'integer', minimum: 0 }`. Optional. Each adapter consumes it for its own bound:

| Old name              | New name                 | Adapter           | Meaning                                  |
|-----------------------|--------------------------|-------------------|------------------------------------------|
| `targets.X.maxPages`  | `targets.X.maxPages`     | HtmlScraper       | Max pages scraped per run                |
| `mediawiki.X.allPagesLimit` | `mediawiki.X.maxPages` | MediaWikiScraper | Max pages enumerated via `allpages`      |
| `crawlers.X.maxPages` | `targets.X.maxPages` (when crawler is co-located with target) | LinkLister | Max BFS depth from seeds |
| (new) cache LRU cap   | `targets.X.maxPages`     | ScraperCache      | Max meta entries before LRU eviction     |

ALL FOUR consumers read from the SAME field. Adapter pattern: the schema describes the user's intent ("don't fetch/store more than N pages for this target"), and each component honors it within its scope.

### H2. Schema changes

- **Remove** `mediawiki.<key>.allPagesLimit`. Replace usages with `mediawiki.<key>.maxPages`.
- **Add** `targets.<key>.maxPages` (was already implicitly there in some configs but never schematized).
- `crawlers.<key>.maxPages` already exists; keep it.
- The orchestrator constructs the `ScraperCache` with `maxEntries: target.maxPages` automatically — no separate cache cap.

### H3. Naming as identity

The principle: every field in the schema names a USER intent, never an implementation detail. "All pages limit" is implementation-leaky (it references the MediaWiki `allpages` API endpoint by name). "Max pages" is the user's actual question. Adapter implementations adapt.

### H4. Acceptance

- [ ] `mediawiki.<key>.allPagesLimit` field removed from `RipperConfigSchema`.
- [ ] `mediawiki.<key>.maxPages` added (or already canonical).
- [ ] `targets.<key>.maxPages` exists.
- [ ] All four consumers (HtmlScraper, MediaWikiScraper, LinkLister, ScraperCache) read from the same `maxPages` field.
- [ ] Every fixture and example config is migrated. Grep for `allPagesLimit` returns zero hits in the repo (other than git history).
