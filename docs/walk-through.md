# Walk-through

Ripperoni is a butcher for the web — it grinds raw HTML into clean cuts of structured JSON. Watch one page go from raw fetch to a finished record.

The target is the [Archives of Nethys](https://2e.aonprd.com/) (aonprd): the Pathfinder Second Edition rules reference. The orchestration lives in `tests/e2e/fixtures/aonprd-crawl.dag.jsonld` and the state in `tests/e2e/fixtures/aonprd-crawler.state.json`. Plugin files live under `plugins/aonprd/`.

---

## The input

The starting point is one detail page:

```
https://2e.aonprd.com/Feats.aspx?ID=750
```

That URL resolves to the Power Attack feat page: a standard AON HTML page with a structured `<h1>`, a header field table, a body block, and inline links to other rules entries.

Ripperoni fetches the raw HTML, hands it to the plugin, and the plugin extracts a typed record.

---

## The state

`tests/e2e/fixtures/aonprd-crawler.state.json` drives the run:

```json
{
  "baseUrl":          "https://2e.aonprd.com",
  "rateLimitMs":      1000,
  "jitterMs":         250,
  "maxRetries":       3,
  "retryBaseDelayMs": 500,
  "retryMaxDelayMs":  30000,
  "headers": {
    "User-Agent": "ripperoni-e2e/2.0 (+https://github.com/Studnicky/ripper)"
  },
  "output": {
    "basePath": "./output",
    "format": "json",
    "pretty": true
  },
  "crawler": {
    "startUrls": [
      "https://2e.aonprd.com/Feats.aspx",
      "https://2e.aonprd.com/Spells.aspx",
      "https://2e.aonprd.com/Monsters.aspx"
    ],
    "domain":      "2e\\.aonprd\\.com",
    "target":      "\\?ID=",
    "delimiter":   "\\.aspx",
    "rateLimitMs": 1000,
    "jitterMs":    250,
    "maxPages":    5000
  }
}
```

`baseUrl` is the root all relative paths resolve against. The `crawler` block configures the built-in `crawl:discover` DAG: seed URLs, domain/target/delimiter regexes, rate limiting, and a `maxPages` ceiling. `cache` is not shown here — when omitted, the runner defaults to `read-write` mode at `output/.cache/aonprd`.

---

## The orchestration

`tests/e2e/fixtures/aonprd-crawl.dag.jsonld` is a JSON-LD document describing a single dagonizer DAG. Its structure (simplified for readability):

```json
{
  "@type": "DAG",
  "name":  "aonprd:crawl",
  "entrypoint": "discover",
  "nodes": [
    {
      "@type": "EmbeddedDAGNode",
      "name":  "discover",
      "dag":   "crawl:discover",
      "stateMapping": {
        "output": { "urls": "crawl.discovered" }
      },
      "outputs": { "success": "scrape", "error": "crawl-failed" }
    },
    {
      "@type":     "ScatterNode",
      "name":      "scrape",
      "source":    "urls",
      "body":      { "dag": "aonprd:page" },
      "container": "worker",
      "itemKey":   "currentUrl",
      "gather": {
        "strategy":   "partition",
        "partitions": { "success": "succeeded", "error": "failed" }
      },
      "reducer": "aggregate",
      "outputs": {
        "all-success": "done",
        "partial":     "done",
        "all-error":   "done",
        "empty":       "done"
      }
    },
    { "@type": "TerminalNode", "name": "done",         "outcome": "completed" },
    { "@type": "TerminalNode", "name": "crawl-failed", "outcome": "failed"    }
  ]
}
```

The `EmbeddedDAGNode` with `dag: "crawl:discover"` runs the built-in link-crawler. Its `stateMapping` seeds `state.urls` from `crawl.discovered` after the crawl completes. The `ScatterNode` fans over `state.urls` — running the plugin's `aonprd:page` DAG once per URL. `container: "worker"` routes items to the parallel worker pool when `parallelWorkers: true` is set in state and the worker registry is built.

---

## The plugin

`plugins/aonprd/` contains three files the runner loads:

- **`index.ts`** — exports `register(dispatcher)`, which registers all taxonomy node instances.
- **`page.dag.jsonld`** — declares the `aonprd:page` per-page DAG: `html:fetch → aonprd:parse (embedded) → json:write`.
- **`parse.dag.jsonld`** — declares the `aonprd:parse` DAG: taxonomy-routed parse.

The entry point:

```ts
// plugins/aonprd/index.ts
import type { RipperDagonizer } from '../../src/dispatcher/RipperDagonizer.js';
import type { ScrapeState }     from '../../src/state/ScrapeState.js';
import { TAXONOMY }             from './taxonomy/aonprd.js';

export function register(dispatcher: RipperDagonizer<ScrapeState>): void {
  for (const node of TAXONOMY.allNodes()) dispatcher.registerNode(node);
}
```

Node instances are registered here. DAGs come from the `*.dag.jsonld` files, which the runner loads automatically — `register` does not call `dispatcher.registerDAG`.

The `aonprd:page` DAG wires the per-page pipeline. Each URL passes through:

| Step | What it does |
|------|-------------|
| `html:fetch` | Rate-limited fetch with retry + backoff. Respects `Retry-After`. Reads from cache on hits. |
| `aonprd:parse` (embedded) | Taxonomy-routed: `aonprd:taxonomy-route` classifies each page from its URL and dispatches to the concept's inherited capability chain. |
| `json:write` | Writes `state.output` to `output/aonprd/<slug>.json`. |

The `aonprd:parse` DAG covers approximately 51 concepts (feats, spells, monsters, equipment, ancestries, …). Unrecognized URLs route to `aonprd:make-unknown`. Shared cheerio helpers (`extractCommon`, `getField`, `htmlToText`, `harvestLinks`) live in `plugins/aonprd/common.ts`.

---

## The run command

```bash
ripperoni run tests/e2e/fixtures/aonprd-crawl.dag.jsonld \
  --state tests/e2e/fixtures/aonprd-crawler.state.json
```

---

## End-to-end steps

1. **Startup**: the runner loads `aonprd-crawl.dag.jsonld`, validates `aonprd-crawler.state.json` against `RunStateSchema`, and builds services (cache, htmlScraper, crawlLimiter, crawlPolicy).
2. **Plugin registration**: `PluginLoader.registerBuiltinNodes` registers all built-in node instances and the `crawl:discover` DAG. `PluginLoader.registerPluginsFromEntry` walks the orchestration's DAG references, derives namespace `aonprd`, loads `plugins/aonprd/index.js` (calls `register(dispatcher)`), and loads all `plugins/aonprd/*.dag.jsonld` files.
3. **Orchestration registered**: `dispatcher.registerDAG(aonprdCrawlDag)` — the top-level DAG goes in last.
4. **State seeded**: `ScrapeState` is initialized; `scrapeState.params = state`.
5. **Dispatch**: `dispatcher.execute('aonprd:crawl', scrapeState)`.
6. **Crawl phase**: `crawl:discover` (cyclic BFS) walks the `startUrls`, follows `.aspx` pages, collects every `?ID=` detail URL, deduplicates, and writes `crawl.discovered` into `state.urls` via the stateMapping.
7. **Scatter phase**: the `ScatterNode` fans over `state.urls` — for each URL, `aonprd:page` runs: `html:fetch` (cache-aware), `aonprd:parse` (taxonomy route → concept chain → `state.output`), `json:write` (one file per record).
8. **Gather**: outcomes partition into `state.succeeded` / `state.failed`. Any URLs still in `state.failed` are written to `failures.json`.

---

## Output record shape

```json
{
  "url":              "https://2e.aonprd.com/Feats.aspx?ID=750",
  "feat_id":          750,
  "name":             "Power Attack",
  "level":            1,
  "rarity":           "common",
  "traits":           ["flourish"],
  "action_cost":      "two-actions",
  "description_text": "You unleash a particularly powerful attack that clobbers your foe but leaves you a bit winded."
}
```

Concept identity is carried by the URL (`Feats.aspx`) and the typed `feat_id` field. Downstream tools (like Squashage) use the URL to derive IRIs and classify the record.

---

## Where to look next

- [Architecture](./architecture): DAG topology, scrapers, package boundaries
- [Getting started](./getting-started): install, scaffold, and first run
- [AONPRD Scraper DAG](./aonprd-scraper-dag): detailed visual walkthrough of the AONPRD orchestration
- [Roadmap](./roadmap): planned and shipped features
