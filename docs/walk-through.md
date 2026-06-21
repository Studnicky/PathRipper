# Walk-through

Ripperoni is a butcher for the web — it grinds raw HTML into clean cuts of structured JSON. Watch one page go from raw fetch to a finished record.

The target is the [Archives of Nethys](https://2e.aonprd.com/) (aonprd): the Pathfinder Second Edition rules reference. Everything below lives in `tests/e2e/fixtures/` and `plugins/aonprd/`.

---

## The input

The starting point is one detail page:

```
https://2e.aonprd.com/Feats.aspx?ID=750
```

That URL resolves to the Power Attack feat page: a standard AON HTML page with a structured `<h1>`, a header field table, a body block, and inline links to other rules entries.

Ripperoni fetches the raw HTML, hands it to the configured plugin, and the plugin extracts a typed record.

---

## The config

The `targets.aonprd` block from `tests/e2e/fixtures/aonprd-crawler.config.json`:

```json
{
  "targets": {
    "aonprd": {
      "baseUrl":          "https://2e.aonprd.com",
      "rateLimitMs":      1000,
      "jitterMs":         250,
      "maxRetries":       3,
      "retryBaseDelayMs": 500,
      "retryMaxDelayMs":  30000,
      "headers": {
        "User-Agent": "ripperoni-e2e/2.0 (+https://github.com/Studnicky/ripper)"
      },
      "pipeline": ["crawl:list-targets", "html:fetch", "aonprd:parse", "json:write"],
      "crawler": {
        "startUrls": ["https://2e.aonprd.com/Feats.aspx", "..."],
        "domain":      "2e\\.aonprd\\.com",
        "target":      "\\?ID=",
        "delimiter":   "\\.aspx",
        "rateLimitMs": 1000,
        "jitterMs":    250,
        "maxPages":    5000
      }
    }
  }
}
```

The crawler (the link-discovery component) lives under `targets.aonprd.crawler`. `crawl:list-targets` runs first — it walks out from the seed URLs and collects every link worth fetching.

Pipeline step breakdown (a pipeline is an ordered list of tasks each page passes through):

| Step | What it does |
|------|-------------|
| `crawl:list-targets` | Walks `crawler.startUrls`, follows links matching `target` within `domain`, and populates `state.urls`. |
| `html:fetch` | Rate-limited fetch with retry + backoff. Respects `Retry-After`. Reads from cache on hits. |
| `aonprd:parse` | Plugin: loads the HTML into cheerio, routes by URL taxonomy, extracts a typed record, writes `state.output`. |
| `json:write` | Writes `state.output` to `./output/aonprd/<slug>.json`. |

---

## The plugin

The plugin lives in `plugins/aonprd/`. Each scrape run executes a DAG (directed acyclic graph — a set of named task nodes wired by dependency edges, powered by [@studnicky/dagonizer](https://github.com/Studnicky/Dagonizer)). The DAG entrypoint for the aonprd plugin is `aonprd:taxonomy-route`, which dispatches to each concept's inherited capability chain (a node, or a single named task unit) based on the URL path. Unrecognised URLs route to `aonprd:make-unknown`.

The plugin entry point (`plugins/aonprd/parse.task.ts`) exports `register(dispatcher)`, which registers all taxonomy-compiled nodes and the `aonprd:parse` DAG:

```ts
import type { RipperDagonizer } from '../../src/dispatcher/RipperDagonizer.js';
import type { ScrapeState }     from '../../src/state/ScrapeState.js';
import { TAXONOMY }             from './taxonomy/aonprd.js';
import { aonprdParseDAG }       from './parse.dag.js';

export function register(dispatcher: RipperDagonizer<ScrapeState>): void {
  for (const node of TAXONOMY.allNodes()) {
    dispatcher.registerNode(node);
  }
  dispatcher.registerDAG(aonprdParseDAG);
}
```

`aonprdParseDAG` is built from the compiled taxonomy via `TAXONOMY.buildDAG('aonprd:parse', '3.0')`. The taxonomy covers ~51 concepts (feats, spells, monsters, equipment, ancestry subclasses, …). Shared cheerio helpers (`extractCommon`, `getField`, `htmlToText`, `harvestLinks`) live in `plugins/aonprd/common.ts`.

Per-item fan-out uses native `{ dag }` scatter (scatter: run the same embedded DAG in parallel over a list of items) via `.embeddedDAG` placements.

---

## The output record

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

## End-to-end run recap

1. **Crawl phase**: `crawl:list-targets` walked the `startUrls`, followed `?ID=` links within `2e.aonprd.com`, and populated `state.urls`.
2. **Rate-limited fetch**: waited `rateLimitMs` (1000ms) plus up to `jitterMs` (250ms) random jitter before each request.
3. **Cache check**: first run hits the network. Subsequent runs read from cache.
4. **Retry logic**: on transient failures (5xx, network timeout), retried up to `maxRetries` times with exponential backoff capped at `retryMaxDelayMs`.
5. **DAG dispatch**: `runHtml` built the phase DAGs, registered the plugin via `PluginLoader`, and dispatched through `RipperDagonizer`. Per-page parse ran in a `{ dag }` scatter (worker-thread pool when the compiled registry is present).
6. **Plugin executed**: `aonprd:parse` entered at `aonprd:taxonomy-route` with the raw HTML in `state.page.html`. The taxonomy routed to the feat concept chain, which ran cheerio selectors and set `state.output`.
7. **Record written**: `json:write` serialized `state.output` to `./output/aonprd/<slug>.json`.

---

## Where to look next

- [Architecture](./architecture); pipeline phases, scraper contracts, extension points
- [Getting started](./getting-started); install, config, and first run
- [Roadmap](./roadmap); planned and shipped features
