---
title: D&D 5e Scraper DAG
description: A visual, top-down walkthrough of the Dungeons & Dragons 5e SRD (dandwiki.com) scrape — the second source plugin, built on the same shared taxonomy compiler as the Pathfinder (AONPRD) scraper.
---

# D&D 5e Scraper DAG

The second real scraper on the block, walked top to bottom — and a direct
counterpart to the [AONPRD Scraper DAG](/aonprd-scraper-dag). Both plugins compile
their parse DAG from the **same** shared taxonomy compiler (`src/taxonomy/`); only
the source markup and the concept extractors differ. Where Pathfinder reads the
Archives of Nethys, this one reads the **D&D 5e SRD on [dandwiki.com](https://www.dandwiki.com)**.

Every diagram below is generated at build time from the **real DAG definitions** by
[`@studnicky/dagonizer`](https://github.com/Studnicky/Dagonizer)'s `MermaidRenderer`
(`docs/.vitepress/scripts/render-dags.mjs`), so the pictures always match the code.

## One compiler, two sources

The Pathfinder and D&D plugins are the two implementations that prove the taxonomy
compiler is plugin-agnostic. They share the routing, capability-chaining, and
DAG-building machinery in `src/taxonomy/`; each supplies its own concept
declarations, extraction strategy, and the one detail that genuinely differs
between the sources — **how a page is routed to its concept**:

| | AONPRD (Pathfinder 2e) | D&D 5e (dandwiki) |
|---|---|---|
| Source | `2e.aonprd.com` | `dandwiki.com/wiki/5e_SRD:<Name>` |
| Markup | bespoke `.aspx` HTML | MediaWiki |
| Concept routing | **by URL** — `Spells.aspx` → `spell` | **by content** — the page body decides |
| Compiler | `Taxonomy.compile(…, { namespace: 'aonprd', pathExtractor })` | `Taxonomy.compile(…, { namespace: 'dnd5e', pathExtractor })` |

dandwiki URLs carry no type signal: `/wiki/5e_SRD:Fireball` and
`/wiki/5e_SRD:Goblin` are indistinguishable by path. So the D&D plugin classifies
each page by inspecting its rendered HTML rather than its URL.

## Content classification

`parseDnd5eHtml` loads the page, classifies it, then runs that concept's capability
chain. A page is a **spell** when its body carries the tell-tale signals:

| Signal | What identifies a spell |
|--------|-------------------------|
| Stat-block table | a `monstats` table with casting-time / range / components / duration rows |
| Breadcrumb category | a breadcrumb whose trail passes through `5e SRD → Spells` |
| Italic type line | an `<i>` lead line such as `3rd-level evocation` (or `evocation cantrip`) |

When no typed concept matches, the page routes to the `generic` fallback — the
documented extension point as the remaining concepts (monster, item, class, race,
feat, condition) are built out.

## The `dnd5e:parse` taxonomy DAG

`plugins/dnd5e/parse.dag.ts` builds the parse DAG from the compiled taxonomy via
`TAXONOMY.buildDAG()` — the same call AONPRD uses. The entrypoint
`dnd5e:taxonomy-route` dispatches to the concept's inherited capability chain
(`dnd5e:load-and-common` → the concept finalizer); pages matching no concept end at
`dnd5e:unknown-end`. Adding a concept extends the taxonomy, not this diagram.

```mermaid
<!--@include: ./_generated/dnd5eParseDAG.mmd -->
```

## The typed record — `SpellOutput`

The `spell` concept is the fully-typed proof concept. Its finalizer reads the shared
extraction, parses the stat-block table, and emits a `SpellOutput`:

```ts
type SpellOutput = {
  url:              string;
  name:             string;
  source:           { book: string | null; page: number | null };
  category:         string | null;
  level:            number | null;   // 0 for cantrips
  school:           string | null;   // e.g. "evocation"
  casting_time:     string | null;
  range:            string | null;
  components:        string | null;  // e.g. "V, S, M (a tiny ball of bat guano…)"
  duration:         string | null;
  higher_levels:    string | null;   // "At Higher Levels" text, or null
  description_text: string;
  sections:         Section[];
  links:            LinkRef[];        // in-page links to related SRD entries
};
```

Parsing `5e_SRD:Fireball` yields:

```json
{
  "url":           "https://www.dandwiki.com/wiki/5e_SRD:Fireball",
  "name":          "Fireball",
  "source":        { "book": "5e SRD", "page": null },
  "category":      "Spells",
  "level":         3,
  "school":        "evocation",
  "casting_time":  "1 action",
  "range":         "150 feet",
  "components":    "V, S, M (a tiny ball of bat guano and sulfur)",
  "duration":      "Instantaneous",
  "higher_levels": "When you cast this spell using a spell slot of 4th level or higher, the damage increases by 1d6 for each slot level above 3rd.",
  "description_text": "A bright streak flashes from your pointing finger…"
}
```

This is the same kind of typed, on-disk-ready record the AONPRD spell concept
produces — the parity that proves the shared compiler carries across sources.

Pages that fall through to the fallback produce a `GenericOutput`:

```ts
type GenericOutput = {
  url:       string;
  name:      string;
  source:    { book: string | null; page: number | null };
  category:  string | null;
  body_text: string;
  sections:  Section[];
  links:     LinkRef[];
};
```

## Direct-call API

The parser runs standalone, no DAG required:

```ts
import { parseDnd5eHtml } from '../../plugins/dnd5e/parse.task.js';

const record = await parseDnd5eHtml(html, 'https://www.dandwiki.com/wiki/5e_SRD:Fireball');
// record: SpellOutput | GenericOutput
```

`parseDnd5eHtml(html, url)` runs the full classification + extraction pipeline and
resolves to a typed record. This is the path proven by
`tests/e2e/dnd5e-parse.test.ts`.

## How the crawl wires up

The dandwiki crawl orchestration is authored exactly like the Pathfinder one:

- **Orchestration**: `tests/e2e/fixtures/dnd5e/dnd5e-crawl.dag.jsonld`
- **State**: `tests/e2e/fixtures/dnd5e/dnd5e-crawler.state.json`

It embeds the built-in `crawl:discover` DAG to walk the `5e_SRD:` namespace via
cyclic BFS, then scatters the discovered URLs over the per-page `dnd5e:page` DAG —
the same orchestration shape the [AONPRD Scraper DAG](/aonprd-scraper-dag) walks in
full.

::: info Proof status
The `dnd5e:parse` taxonomy and its typed output are real and verified by
`tests/e2e/dnd5e-parse.test.ts`. Composing it into the per-page pipeline as
`html:fetch → dnd5e:parse → json:write` (the structured counterpart to
`aonprd:page`) and broadening beyond the `spell` concept are the documented next
steps; the current crawl demo emits Markdown via [`markdown:write`](/usage/markdown).
:::

## See also

- [AONPRD Scraper DAG](/aonprd-scraper-dag) — the Pathfinder counterpart, wired end to end.
- [Plugins](/usage/plugins) — the shared taxonomy compiler and plugin contract.
- [Architecture](/architecture) — the DAG model, `src/taxonomy/`, scrapers.
- [Markdown output](/usage/markdown) — the `markdown:write` node the crawl demo uses today.
