---
layout: doc
title: Plugins
---

# Plugins

A plugin is a file that exports a named `register` function. The runner imports the file and calls `register(dispatcher)` to attach all plugin nodes and DAGs to the current scrape run's dispatcher. Plugins never call any global registration function — all wiring is explicit and scoped to the dispatcher passed by the runner.

## Plugin contract

Every plugin file must export:

```ts
export function register(dispatcher: RipperDagonizer<ScrapeState>): void
```

The runner resolves the plugin file path from the pipeline config entry, imports it, and calls `register` with the run's dispatcher instance. Any missing `register` export is a hard error at startup.

## Node signature

```ts
import type { NodeInterface, NodeContextInterface } from '@studnicky/dagonizer';
import type { ScrapeState }    from 'ripperoni/state/ScrapeState';
import type { RipperServices } from 'ripperoni/services/RipperServices';
import type { RipperDagonizer } from 'ripperoni/dispatcher/RipperDagonizer';

export const myParseNode: NodeInterface<ScrapeState, 'success' | 'error', RipperServices> = {
  name:    'mysite:parse',
  outputs: ['success', 'error'],

  async execute(state, context) {
    const html = state.page.html ?? '';
    if (html.length === 0) { return { output: 'error' }; }

    // extract...
    state.output = { url: state.page.url, name: 'Example' };
    return { output: 'success' };
  },
};

export function register(dispatcher: RipperDagonizer<ScrapeState>): void {
  dispatcher.registerNode(myParseNode);
}
```

### Output ports

Declare every port the node can return in `outputs`. The dispatcher validates wiring at registration time and rejects DAGs with un-wired outputs.

Common conventions:
- `success` — processed cleanly; downstream write node runs.
- `error` — fetch failed, parse failed, or required data absent; item recorded in `state.failed`.
- `skipped` — optional skip (e.g. `json:write` when `state.output` is null).
- `valid` / `invalid` — used by `validate:schema` for schema-pass / schema-fail branching.

In the composite per-item node the runner builds from `pipeline: [...]` config, any non-`success` port short-circuits the remaining steps for that item. The `error` path is the universal failure route.

### State shape

```ts
state.page.url       // resolved URL (html targets)
state.page.html      // raw HTML string (populated by html:fetch)
state.page.title     // page title (wiki targets)
state.page.wikitext  // raw wikitext (populated by wiki:fetch)
state.output         // null until your plugin sets it; write nodes read this
```

`state.getMetadata(key)` / `state.setMetadata(key, value)` carries per-item data across nodes within the same fan-out item.

### Services

`context.services` carries shared dependencies:

```ts
context.services.log           // Logger
context.services.cache         // ScraperCache | null
context.services.htmlScraper   // HtmlScraper (html targets)
context.services.wikiScraper   // MediaWikiScraper (wiki targets)
context.services.target.id     // target block name
context.services.target.cfg    // raw target config
context.services.outDir        // output base directory
context.services.pluginTaskName // name of first non-built-in pipeline step
```

### Cancellation

Long-running IO should propagate `context.signal`:

```ts
const res = await fetch(url, { signal: context.signal });
```

## HTML plugin example

```ts
import { load } from 'cheerio';
import type { NodeInterface } from '@studnicky/dagonizer';
import type { ScrapeState }    from 'ripperoni/state/ScrapeState';
import type { RipperServices } from 'ripperoni/services/RipperServices';
import type { RipperDagonizer } from 'ripperoni/dispatcher/RipperDagonizer';

export const myParseNode: NodeInterface<ScrapeState, 'success' | 'error', RipperServices> = {
  name:    'mysite:parse',
  outputs: ['success', 'error'],
  async execute(state) {
    const html = state.page.html;
    if (!html) return { output: 'error' };

    const $ = load(html);
    state.output = {
      url:  state.page.url,
      name: $('h1.title').first().text().trim(),
    };
    return { output: 'success' };
  },
};

export function register(dispatcher: RipperDagonizer<ScrapeState>): void {
  dispatcher.registerNode(myParseNode);
}
```

## MediaWiki plugin example

```ts
import wtf from 'wtf_wikipedia';
import type { NodeInterface } from '@studnicky/dagonizer';
import type { ScrapeState }    from 'ripperoni/state/ScrapeState';
import type { RipperServices } from 'ripperoni/services/RipperServices';
import type { RipperDagonizer } from 'ripperoni/dispatcher/RipperDagonizer';

export const myWikiNode: NodeInterface<ScrapeState, 'success', RipperServices> = {
  name:    'mywiki:parse',
  outputs: ['success'],
  async execute(state) {
    const doc  = wtf(state.page.wikitext ?? '');
    const ibox = doc.infobox()?.json() as Record<string, string> ?? {};
    state.output = {
      name:  ibox['name'] ?? state.page.title,
      level: parseInt(ibox['level'] ?? '', 10) || null,
    };
    return { output: 'success' };
  },
};

export function register(dispatcher: RipperDagonizer<ScrapeState>): void {
  dispatcher.registerNode(myWikiNode);
}
```

## Loading plugins

Declare plugin paths in the target config (resolved relative to the config file):

```json
{
  "targets": {
    "mysite": {
      "baseUrl": "https://example.com",
      "pipeline": ["html:fetch", "mysite:parse", "json:write"]
    }
  }
}
```

The runner automatically derives the plugin file path from non-built-in pipeline entries:
- Entry `mysite:parse` → loads `./plugins/mysite/parse.task.js` relative to `configDir`.

The runner imports the module and calls its `register(dispatcher)` export. If the export is missing, the run aborts with an error listing the expected function signature.

## Multi-node plugins

Plugins that need multiple nodes (e.g. a parse node and a finalize node) register all of them in `register`:

```ts
export function register(dispatcher: RipperDagonizer<ScrapeState>): void {
  dispatcher.registerNode(parseNode);
  dispatcher.registerNode(finalizeNode);
  dispatcher.registerDAG(myPluginDAG);
}
```

When the pipeline step resolves to a registered DAG name, the runner emits an `embeddedDAG` placement and wires its output mapping so downstream steps (e.g. `json:write`) see the parsed record.

## Testing a plugin in isolation

Call `node.execute()` directly with a `ScrapeState` and a stub context:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ScrapeState } from 'ripperoni/state/ScrapeState';
import { myParseNode } from './my-plugin.js';
import { Logger } from 'ripperoni/modules/logger/logger';

const state = new ScrapeState();
state.page = { targetId: 'mysite', title: '', url: 'https://example.com/page', html: '<h1 class="title">Hello</h1>' };

const ctx = {
  services: { log: Logger.forComponent('test'), cache: null, target: { id: 'mysite', cfg: {} }, outDir: '/tmp' },
  signal: new AbortController().signal,
  dagName: 'test', nodeName: 'mysite:parse', runId: 'test',
};

const result = await myParseNode.execute(state, ctx);
assert.equal(result.output, 'success');
assert.equal((state.output as { name: string }).name, 'Hello');
```

No network, no file system, no DAG overhead — just the extraction logic.

## AONPRD plugin (built-in example)

The `plugins/aonprd/` directory ships a full-featured example plugin that parses Archives of Nethys (2e.aonprd.com) HTML. It demonstrates URL-based concept dispatch via a taxonomy, shared extraction capabilities, per-concept structured output, and fixture-based unit testing.

The entry point `plugins/aonprd/parse.task.ts` exports `register(dispatcher)` which iterates all taxonomy-compiled nodes and registers them plus the `aonprd:parse` DAG on the dispatcher.

See [Architecture](/architecture) for the DAG topology and `plugins/aonprd/parse.task.ts` for the reference implementation.

## Related

- [Orchestration](/usage/pipeline) — how the DAG dispatch works
- [Scrapers](/usage/scrapers) — what state.page looks like per scraper type
- [MediaWiki](/usage/mediawiki) — wiki-specific state
- [Configuration](/usage/configuration) — how to declare pipeline steps in config
