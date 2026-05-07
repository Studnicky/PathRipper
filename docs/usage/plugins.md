---
layout: doc
title: Plugins
---

# Plugins

A plugin is a file that calls `TaskRegistry.register` at module load time. The orchestrator loads the file, the registration fires as a side effect, and the task is available under its name.

## Task signature

```ts
type TaskFnType<TState> = (next: () => Promise<void>, state: TState) => Promise<void>
```

The task receives `next` (call it when you're done) and `state` (the pipeline state for the current page). Call `await next()` at the end.

Error handling: If your plugin throws an error, the error bubbles out of the pipeline and halts the orchestrator. There's no error recovery; the run fails. If you want to skip a malformed page gracefully, don't throw; instead, skip `await next()` or set a flag on state. The write task downstream can check the flag and decide whether to write.

Plugin-load timing: Plugins are loaded by `TaskRegistry.load()` which imports the plugin file as an ES module. The module's top-level `TaskRegistry.register()` calls fire immediately. This happens before the orchestrator starts scraping, during the config parsing phase. If you have a syntax error in your plugin, you'll see it before any pages are scraped.

## State shape per scraper

For HTML targets, state.input is populated by `html:fetch`:

```ts
state.targetId           // the target block name (from config)
state.source.url         // the URL being processed
state.input.html         // raw HTML string
state.input.url          // the URL fetched
state.output             // null until your plugin sets it; json:write reads this
```

For MediaWiki targets, the orchestrator populates state.input before your plugin runs:

```ts
state.targetId           // the mediawiki block name (from config)
state.source.url         // the canonical wiki page URL
state.input.url          // the canonical wiki page URL
state.input.title        // page title
state.input.wikitext     // raw wikitext string
state.input.parsedPage   // WikitextParser output (infobox, sections, categories)
state.output             // null until your plugin sets it; json:write reads this
```

Inter-plugin state coordination: If you have multiple tasks in your pipeline (e.g. a pre-parse task that enriches state), they share the same state object. Task 1 can set arbitrary fields on state, and Task 2 sees them. This is how data flows between tasks without tight coupling. Tasks can attach extra keys using the `Record<string, unknown>` index signature.

Plugin isolation: Plugins run serially within the pipeline for a single page, but the orchestrator runs multiple pages in parallel (via concurrency setting). Two pages never share state; they each get their own state object. Your plugin can't have global side effects that affect other pages (no shared counters, no global state mutations). If you need to coordinate across pages, use the file system or an external service.

## HTML plugin

Your task gets `state.input.html` and a URL. Use cheerio to pull out what you need:

```ts
import { TaskRegistry } from 'ripperoni/registry/TaskRegistry';
import * as cheerio from 'cheerio';

TaskRegistry.register('mysite:parse', async (next, state) => {
  const html = state.input['html'] as string;
  const url  = state.input['url'] as string;
  const $    = cheerio.load(html);

  const name        = $('h1.title').first().text().trim();
  const description = $('div.content p').first().text().trim();

  state.output = {
    _type:       'article',
    url,
    name,
    description,
    _source: {
      target: state.targetId,
      url,
      plugin: 'mysite:parse',
    },
  };

  await next();
});
```

No HTTP in the plugin. No file I/O. No cheerio initialization; `html:fetch` has already fetched; you load the string into cheerio yourself. The pipeline handles the I/O, you handle the extraction.

## MediaWiki plugin

For wiki targets, the wikitext is pre-parsed. Use `state.input.parsedPage`:

```ts
import { TaskRegistry } from 'ripperoni/registry/TaskRegistry';

TaskRegistry.register('mywiki:parse', async (next, state) => {
  const page = state.input['parsedPage'] as {
    title:    string;
    infobox:  Record<string, string>;
    sections: Array<{ title: string; wikitext: string }>;
    categories: string[];
  };
  const url = state.input['url'] as string;

  // Typed accessor: string | null
  const name  = page.infobox['name'] ?? page.title;
  // Parse as number
  const level = parseInt(page.infobox['level'] ?? '', 10) || null;

  state.output = {
    _type:  'entry',
    url,
    name,
    level,
    categories: page.categories,
    _source: {
      target: state.targetId,
      url,
      plugin: 'mywiki:parse',
    },
  };

  await next();
});
```

## The _type discriminator convention

Every record should have `_type`. It's the field downstream tools (like Squashage) use for classification. Pick a string per record type and keep it consistent across your plugin.

## The _source block

Every record should have `_source`. Include at minimum `target`, `url`, and `plugin`. Squashage reads `_source.url` to derive graph IRIs; if it's missing, IRI derivation falls back to a default.

```ts
_source: {
  target: state.targetId,  // the name of the config block
  url,                     // the canonical source URL
  plugin: 'mysite:parse',  // the task that produced the record
}
```

## Loading plugins

Plugins are declared in the target config under `plugins` (array of paths relative to the config file):

```json
{
  "targets": {
    "mysite": {
      "plugins": ["./plugins/mysite.js"],
      "pipeline": ["html:fetch", "mysite:parse", "json:write"]
    }
  }
}
```

Plugins are loaded in array order. If two plugins register the same task name, the second one wins (overwrites the first). This allows test plugins to shadow production ones if you load them after.

Or load manually in code:

```ts
await TaskRegistry.load('./plugins/mysite.js');
```

The module's top-level `TaskRegistry.register(...)` calls fire on import. Plugin file paths are resolved relative to `process.cwd()`, not relative to the config file.

## Testing a plugin in isolation

```ts
import { Pipeline } from 'ripperoni/pipeline/Pipeline';
import { TaskRegistry } from 'ripperoni/registry/TaskRegistry';
import './my-plugin.js'; // side-effect: registers the task

const pipeline = new Pipeline({ name: 'test' });
pipeline.addTaskByName('mysite:parse');

const state = {
  targetId: 'mysite',
  source:   { url: 'https://example.com/page' },
  input:    { html: '<html><h1 class="title">Hello</h1></html>', url: 'https://example.com/page' },
  output:   null,
};

await pipeline.execute(state);
console.log(state.output); // your extracted record
```

No HTTP, no file system, no network. Just the extraction logic.

## AONPRD plugin (built-in example)

The `plugins/aonprd/` directory ships a full-featured example plugin that parses
Archives of Nethys (2e.aonprd.com) HTML. It demonstrates all major patterns: URL-based
type dispatch, shared extraction utilities, per-type structured output, and fixture-based
unit testing.

### Output types

Every AONPRD output carries a `_type` discriminator and the following common fields:

| Field | Type | Description |
|---|---|---|
| `url` | `string` | Source URL |
| `entity_id` | `number \| null` | Numeric `?ID=N` from the URL |
| `name` | `string` | Display name |
| `source` | `SourceRef` | First source book reference |
| `sources` | `SourceRef[]` | All source references on the page |
| `traits` | `string[]` | Trait pill labels in source order |
| `trait_ids` | `Record<string, number>` | Traits.aspx ID keyed by trait name |
| `rarity` | `Rarity` | unique, rare, uncommon, or common |
| `pfs` | `PfsLegality \| null` | PFS Standard, Limited, or Restricted |
| `legacy` | `boolean` | Page carries a legacy-content-warning |
| `alt_edition_url` | `string \| null` | Sibling page URL (legacy/remaster redirect) |
| `meta_description` | `string \| null` | `<meta name="description">` content |
| `meta_keywords` | `string \| null` | `<meta name="keywords">` content |
| `raw_fields` | `Record<string, string>` | All header label/value pairs |
| `links` | `LinkRef[]` | All internal cross-reference anchors |

### Per-type additional fields

**Spell** (`_type: 'spell'`): `spell_id`, `kind` (spell/cantrip/focus/ritual), `rank`,
`traditions[]`, `cast`, `range`, `area`, `targets`, `defense` (remaster Defense field),
`saving_throw`, `duration`, `bloodlines[]`, `domain[]`, `cult[]`, `deities[]`,
`mysteries[]`, `patron_themes[]`, `catalysts[]`, `outcomes`, `affliction`, `heightened[]`.

**Feat** (`_type: 'feat'`): `feat_id`, `level`, `action_cost`, `archetypes[]`,
`prerequisites`, `frequency`, `trigger`, `requirements`, `is_mythic`, `leads_to[]`,
`related_feats[]`, `trait_glossary[]`.

**Monster** (`_type: 'monster'`): `monster_id`, `level`, `size`, `alignment`,
`recall_knowledge`, `perception`, `languages`, `skills[]`, `abilities`, `ac`, `saves`,
`hp`, `immunities[]`, `weaknesses[]`, `resistances[]`, `speed`, `strikes[]`,
`spell_lists[]`, `top_abilities[]`, `defensive_abilities[]`, `offensive_abilities[]`,
`variants[]`, `family_links[]`.

**Weapon** (`_type: 'weapon'`): `weapon_id`, `price`, `damage`, `bulk`, `hands`, `reload`,
`range`, `ammunition`, `weapon_type`, `category`, `group`, `favored_weapon[]`,
`critical_specialization`, `specific_magic_weapons[]`, `trait_glossary[]`.

**Armor** (`_type: 'armor'`): `armor_id`, `price`, `ac_bonus`, `dex_cap`, `check_penalty`,
`speed_penalty`, `strength`, `bulk`, `category`, `group`.

**Equipment** (`_type: 'equipment'`): `equipment_id`, `item_level`, `tiered_variants`,
`price`, `bulk`, `usage`, `hands`, `activations[]`, `variants[]`.

**Background** (`_type: 'background'`): `entity_id`, `attribute_boost_choice`,
`trained_skills[]`, `lore_skills[]`, `granted_feat`, `flavor_text`, `related_sources[]`.

**Ancestry** (`_type: 'ancestry'`): `entity_id`, `mechanics` (hit_points, size, speed,
attribute_boosts, languages, vision, granted), `popular_edicts`, `popular_anathema`.

**Class** (`_type: 'class'`): `entity_id`, `key_attribute`, `hp_per_level`,
`initial_proficiencies`, `class_dc`, `subclasses[]`.

**Condition** (`_type: 'condition'`): `entity_id`, `stages[]`, `related_conditions[]`.

**Trait** (`_type: 'trait'`): `entity_id`, `category`.

**Hazard** (`_type: 'hazard'`): `entity_id`, `level`, `complexity`, `stealth`,
`disable[]`, `defenses`, `routines[]`, `reset`.

### Testing the AONPRD plugin

Fixture-based tests live in `tests/e2e/plugins/aonprd.parse.test.ts`. They load HTML
files from `tests/e2e/plugins/fixtures/aonprd/` and verify extraction without any network.
To add a new fixture, copy a body file from the pointer-store cache and assert specific
field values against the known page.

## Related

- [Pipeline](./pipeline); how the task queue works
- [Scrapers](./scrapers); what state.input looks like per scraper type
- [MediaWiki](./mediawiki); infobox helpers and wiki-specific state
- [Configuration](./configuration); how to declare plugins in config
