---
layout: doc
title: Plugins
---

# Plugins

A plugin is a file that exports a `NodeInterface` and calls `registerGlobalNode` at module load time. The orchestrator imports the file (side-effect), the node is registered, and it is available by name in the user's `pipeline` config array.

## Node signature

```ts
import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { ScrapeState }   from 'ripperoni/state/ScrapeState';
import type { AppServices }   from 'ripperoni/nodes';
import { registerGlobalNode } from 'ripperoni/orchestrators/ScrapeOrchestrator';

export const myParseNode: NodeInterface<ScrapeState, 'success' | 'error', AppServices> = {
  name:    'mysite:parse',
  outputs: ['success', 'error'],

  async execute(state, context) {
    const html = state.page.html ?? '';
    if (html.length === 0) { return { output: 'error' }; }

    // extract...
    state.output = { _type: 'article', name: 'Example' };
    return { output: 'success' };
  },
};

registerGlobalNode(myParseNode);
```

### Output ports

Declare every port the node can return in `outputs`. The dispatcher validates wiring at registration time and rejects DAGs with un-wired outputs.

Common conventions:
- `success` — processed cleanly; downstream write node runs.
- `error` — fetch failed, parse failed, or required data absent; item recorded in `state.failed`.
- `skipped` — optional skip (e.g. `json:write` when `state.output` is null).
- `valid` / `invalid` — used by `validate:schema` for schema-pass / schema-fail branching.

In the composite per-item node the orchestrator builds from `pipeline: [...]` config, any non-`success` port short-circuits the remaining steps for that item. The `error` path is the universal failure route.

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
import type { NodeInterface } from '@noocodex/dagonizer';
import type { ScrapeState, AppServices } from 'ripperoni/nodes';
import { registerGlobalNode } from 'ripperoni/orchestrators/ScrapeOrchestrator';

export const myParseNode: NodeInterface<ScrapeState, 'success' | 'error', AppServices> = {
  name:    'mysite:parse',
  outputs: ['success', 'error'],
  async execute(state) {
    const html = state.page.html;
    if (!html) return { output: 'error' };

    const $ = load(html);
    state.output = {
      _type: 'article',
      url:   state.page.url,
      name:  $('h1.title').first().text().trim(),
    };
    return { output: 'success' };
  },
};

registerGlobalNode(myParseNode);
```

## MediaWiki plugin example

```ts
import wtf from 'wtf_wikipedia';
import type { NodeInterface } from '@noocodex/dagonizer';
import type { ScrapeState, AppServices } from 'ripperoni/nodes';
import { registerGlobalNode } from 'ripperoni/orchestrators/ScrapeOrchestrator';

export const myWikiNode: NodeInterface<ScrapeState, 'success', AppServices> = {
  name:    'mywiki:parse',
  outputs: ['success'],
  async execute(state) {
    const doc   = wtf(state.page.wikitext ?? '');
    const ibox  = doc.infobox()?.json() as Record<string, string> ?? {};
    state.output = {
      _type:  'entry',
      name:   ibox['name'] ?? state.page.title,
      level:  parseInt(ibox['level'] ?? '', 10) || null,
    };
    return { output: 'success' };
  },
};

registerGlobalNode(myWikiNode);
```

## The _type discriminator convention

Every record should have `_type`. Downstream tools use it for classification. Pick a string per record type and keep it consistent across your plugin.

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

The orchestrator automatically derives the plugin file path from non-built-in pipeline entries:
- Entry `mysite:parse` → loads `./plugins/mysite/parse.task.js` relative to `configDir`.

Or self-register explicitly by importing the plugin before calling `scrapeHtml`:

```ts
import './plugins/mysite/parse.task.js'; // side-effect: calls registerGlobalNode
await ScrapeOrchestrator.scrapeHtml(opts);
```

## Testing a plugin in isolation

Call `node.execute()` directly with a `ScrapeState` and a stub context:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ScrapeState } from 'ripperoni/state/ScrapeState';
import { myParseNode } from './my-plugin.js';
import { Logger } from 'ripperoni/Logger';

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

The `plugins/aonprd/` directory ships a full-featured example plugin that parses Archives of Nethys (2e.aonprd.com) HTML. It demonstrates URL-based type dispatch, shared extraction utilities, per-type structured output, and fixture-based unit testing.

See [Architecture](/architecture) for the DAG topology and `plugins/aonprd/parse.task.ts` for the reference implementation.

## Related

- [Orchestration](/usage/pipeline) — how the DAG dispatch works
- [Scrapers](/usage/scrapers) — what state.page looks like per scraper type
- [MediaWiki](/usage/mediawiki) — wiki-specific state
- [Configuration](/usage/configuration) — how to declare pipeline steps in config
