# Walk-through

One concrete end-to-end example from URL to structured JSON record. The target is the [Archives of Nethys](https://2e.aonprd.com/) (aonprd): the Pathfinder Second Edition rules reference. All of this is in `tests/e2e/fixtures/` and `plugins/aonprd/`.

---

## Before: the input

Point Ripperoni at a detail page:

```
https://2e.aonprd.com/Feats.aspx?ID=750
```

That URL resolves to the Power Attack feat page: a standard AON HTML page with a structured `<h1>`, a header field table, a body block, and inline links to other rules entries.

Ripperoni fetches the raw HTML, hands it to the configured plugin, and the plugin extracts a typed record. You never see raw HTML in your output.

---

## The config

The `targets.aonprd` block from `tests/e2e/fixtures/pathripper-legacy.config.json`:

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
        "User-Agent": "ripperoni/2.0 (+https://github.com/Studnicky/Ripperoni)"
      },
      "pipeline": [
        "html:fetch",
        "aonprd:parse",
        "json:write"
      ],
      "cache": {
        "dir": "./output/.cache/aonprd",
        "mode": "read-write"
      }
    }
  }
}
```

Pipeline step breakdown:

| Step | What it does |
|------|-------------|
| `html:fetch` | Rate-limited fetch with retry + backoff. Respects `Retry-After`. Reads from cache on hits. |
| `aonprd:parse` | Plugin: loads the HTML into cheerio, extracts structured fields, writes `state.output`. |
| `json:write` | Writes `state.output` to `./output/aonprd/<slug>.json`. |

---

## The plugin

The relevant slice of `plugins/aonprd/feat.ts` (pure extraction — no HTTP, no I/O):

```ts
import type { CheerioAPI } from 'cheerio';
import { getField, htmlToText, harvestLinks } from './common.js';

export interface FeatOutput {
  _type:       'feat';
  url:         string;
  name:        string;
  level:       number | null;
  rarity:      string;
  traits:      string[];
  action_cost: string | null;
  description_text: string;
  _source:     { target: string; url: string; plugin: string };
}

export function extractFeat($: CheerioAPI, url: string): FeatOutput {
  const name       = $('h1.title').first().text().trim();
  const level      = parseInt(getField($, 'Level') ?? '', 10) || null;
  const rarity     = (getField($, 'Rarity') ?? 'common').toLowerCase();
  const traits     = $('span.trait a').map((_, el) => $(el).text().trim()).get();
  const action_cost = getField($, 'Actions') ?? null;
  const description_text = htmlToText($('#ctl00_MainContent_DetailedOutput').html() ?? '');

  return {
    _type:  'feat',
    url,
    name,
    level,
    rarity,
    traits,
    action_cost,
    description_text,
    _source: { target: 'aonprd', url, plugin: 'aonprd:parse' },
  };
}
```

`getField`, `htmlToText`, and `harvestLinks` are shared helpers in `plugins/aonprd/common.ts`. `extractFeat` receives a `CheerioAPI` instance; no HTTP, no I/O, no side effects.

The plugin entry point (`plugins/aonprd/parse.task.ts`) wraps this into a `NodeInterface` and self-registers:

```ts
import type { NodeInterface } from '@noocodex/dagonizer';
import type { ScrapeState, AppServices } from 'ripperoni/nodes';
import { registerGlobalNode } from 'ripperoni/orchestrators/ScrapeOrchestrator';

export const aonprdParseNode: NodeInterface<ScrapeState, 'success' | 'error' | 'unknown', AppServices> = {
  name:    'aonprd:parse',
  outputs: ['success', 'error', 'unknown'],
  async execute(state) {
    const html = state.page.html;
    if (html === undefined) { return { output: 'unknown' }; }
    state.output = parseAonHtml(html, state.page.url) as unknown as Record<string, unknown>;
    return { output: 'success' };
  },
};

registerGlobalNode(aonprdParseNode);
```

The node declares named output ports. The dispatcher routes `success` to the next step (`json:write`), `error` and `unknown` to the failure collector.

---

## After: the JSON record

```json
{
  "_type":            "feat",
  "url":              "https://2e.aonprd.com/Feats.aspx?ID=750",
  "name":             "Power Attack",
  "level":            1,
  "rarity":           "common",
  "traits":           ["flourish"],
  "action_cost":      "two-actions",
  "description_text": "You unleash a particularly powerful attack that clobbers your foe but leaves you a bit winded.",
  "_source": {
    "target": "aonprd",
    "url":    "https://2e.aonprd.com/Feats.aspx?ID=750",
    "plugin": "aonprd:parse"
  }
}
```

The `_source` block makes the record traceable back to its origin page. Downstream tools (like Squashage) use `_source.url` to derive IRIs without hardcoding a domain.

---

## What ran in between

1. **Rate-limited fetch**: waited `rateLimitMs` (1000ms) + up to `jitterMs` (250ms) random jitter before the request.
2. **Cache check**: first run: cache miss, HTTP GET. Subsequent runs: cache hit, no network request.
3. **Retry logic**: on transient failures (5xx, network timeout), retried up to `maxRetries` times with exponential backoff capped at `retryMaxDelayMs`.
4. **DAG dispatch**: `ScrapeOrchestrator` built a fan-out DAG over the URL list, dispatched via `Dagonizer`. The `html:fetch` node returned `success`; the `aonprd:parse` node ran next.
5. **Plugin executed**: `aonprd:parse` ran with `state.page.html` containing the raw HTML. The extractor ran cheerio selectors and set `state.output`.
6. **Record written**: `json:write` serialized `state.output` to `./output/aonprd/aonprd:parse/Feats.aspx-ID-750.json`.

---

## Where to look next

- [Architecture](./architecture); pipeline phases, scraper contracts, extension points
- [Getting started](./getting-started); install, config, and first run
- [Roadmap](./roadmap); planned and shipped features
