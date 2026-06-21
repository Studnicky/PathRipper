---
layout: doc
title: Plugins
---

# Plugins

A plugin teaches Ripperoni how to turn one site's HTML or wikitext into typed JSON. Each plugin is a dagonizer node — a `ScalarNode` subclass (from [@studnicky/dagonizer](https://github.com/Studnicky/Dagonizer)) — that you register on the run's dispatcher. The pipeline is a DAG (directed acyclic graph) assembled by the engine from built-in nodes and plugin nodes alike; the dispatcher is the object that owns node and DAG registration, routes state through them, and wires outputs to downstream steps. A plugin exports a `register` function. The runner imports the file, calls `register(dispatcher)`, and your nodes join the run. All wiring is explicit and scoped to the dispatcher the runner passes in.

## Plugin contract

Every plugin file must export:

```ts
export function register(dispatcher: RipperDagonizer<ScrapeState>): void
```

The runner resolves the plugin file path from the pipeline config entry, imports it, and calls `register` with the run's dispatcher instance. A missing `register` export aborts the run with an error at startup.

## Node signature

Nodes are `ScalarNode` subclasses. The subclass declares `name` and `outputs` as readonly fields and implements `executeOne(state, context)`, which returns `NodeOutputBuilder.of('<port>')`. Raw HTML or wikitext goes in via `state`; your node writes a structured record to `state.output` before returning.

```ts
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';
import type { ScrapeState }    from 'ripperoni/state/ScrapeState';
import type { RipperServices } from 'ripperoni/services/RipperServices';
import type { RipperDagonizer } from 'ripperoni/dispatcher/RipperDagonizer';

class MyParseNodeImpl extends ScalarNode<ScrapeState, 'success' | 'error', RipperServices> {
  public readonly name    = 'mysite:parse';
  public readonly outputs = ['success', 'error'] as const;

  protected override async executeOne(
    state:    ScrapeState,
    context:  NodeContextType<RipperServices>,
  ): Promise<NodeOutputType<'success' | 'error'>> {
    const html = state.page.html ?? '';
    if (html.length === 0) return NodeOutputBuilder.of('error');

    // extract...
    state.output = { url: state.page.url, name: 'Example' };
    return NodeOutputBuilder.of('success');
  }
}

export const myParseNode = new MyParseNodeImpl();

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

In the composite per-item node the runner assembles from `pipeline: [...]` config, any non-`success` port short-circuits the remaining steps for that item. The `error` path is the universal failure route.

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
context.services.log             // Logger
context.services.cache           // ScraperCache | null
context.services.htmlScraper     // HtmlScraper | undefined (html targets)
context.services.wikiScraper     // MediaWikiScraper | undefined (wiki targets)
context.services.target.id       // target block name
context.services.target.cfg      // raw target config
context.services.outDir          // output base directory
context.services.pluginTaskName  // name of first non-built-in pipeline step (optional)
context.services.splitByTaskName // when false, output is a single JSONL (optional)
context.services.dispatcher      // DagonizerInterface for child DAG execution
```

### Cancellation

Long-running IO should propagate `context.signal`:

```ts
const res = await fetch(url, { signal: context.signal });
```

## HTML plugin example

```ts
import { load } from 'cheerio';

import { ScalarNode, NodeOutputBuilder, DAGBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, DAGType } from '@studnicky/dagonizer';
import type { ScrapeState }    from 'ripperoni/state/ScrapeState';
import type { RipperServices } from 'ripperoni/services/RipperServices';
import type { RipperDagonizer } from 'ripperoni/dispatcher/RipperDagonizer';

class MyParseNodeImpl extends ScalarNode<ScrapeState, 'success' | 'error', RipperServices> {
  public readonly name    = 'mysite:parse-impl';
  public readonly outputs = ['success', 'error'] as const;

  protected override async executeOne(
    state:    ScrapeState,
    _context: NodeContextType<RipperServices>,
  ): Promise<NodeOutputType<'success' | 'error'>> {
    const html = state.page.html;
    if (!html) return NodeOutputBuilder.of('error');

    const $ = load(html);
    state.output = {
      url:  state.page.url,
      name: $('h1.title').first().text().trim(),
    };
    return NodeOutputBuilder.of('success');
  }
}

export const myParseNode = new MyParseNodeImpl();

export const myParseFlow: DAGType = new DAGBuilder('mysite:parse', '1.0')
  .entrypoint('mysite:parse-impl')
  .node('mysite:parse-impl', myParseNode, { success: 'mysite:parse:done', error: 'mysite:parse:done' })
  .terminal('mysite:parse:done', { outcome: 'completed' })
  .build();

export function register(dispatcher: RipperDagonizer<ScrapeState>): void {
  dispatcher.registerNode(myParseNode);
  dispatcher.registerDAG(myParseFlow);
}
```

## MediaWiki plugin example

```ts
import wtf from 'wtf_wikipedia';

import { ScalarNode, NodeOutputBuilder, DAGBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, DAGType } from '@studnicky/dagonizer';
import type { ScrapeState }    from 'ripperoni/state/ScrapeState';
import type { RipperServices } from 'ripperoni/services/RipperServices';
import type { RipperDagonizer } from 'ripperoni/dispatcher/RipperDagonizer';

class MyWikiNodeImpl extends ScalarNode<ScrapeState, 'success', RipperServices> {
  public readonly name    = 'mywiki:parse-impl';
  public readonly outputs = ['success'] as const;

  protected override async executeOne(
    state:    ScrapeState,
    _context: NodeContextType<RipperServices>,
  ): Promise<NodeOutputType<'success'>> {
    const doc  = wtf(state.page.wikitext ?? '');
    const ibox = doc.infobox()?.json() as Record<string, string> ?? {};
    state.output = {
      name:  ibox['name'] ?? state.page.title,
      level: parseInt(ibox['level'] ?? '', 10) || null,
    };
    return NodeOutputBuilder.of('success');
  }
}

export const myWikiNode = new MyWikiNodeImpl();

export const myWikiFlow: DAGType = new DAGBuilder('mywiki:parse', '1.0')
  .entrypoint('mywiki:parse-impl')
  .node('mywiki:parse-impl', myWikiNode, { success: 'mywiki:parse:done' })
  .terminal('mywiki:parse:done', { outcome: 'completed' })
  .build();

export function register(dispatcher: RipperDagonizer<ScrapeState>): void {
  dispatcher.registerNode(myWikiNode);
  dispatcher.registerDAG(myWikiFlow);
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

The runner derives the plugin file path from non-built-in pipeline entries:
- Entry `mysite:parse` → loads `./plugins/mysite/parse.task.js` relative to `configDir`.

The runner imports the module and calls `register(dispatcher)`. A missing export aborts the run with an error listing the expected function signature.

## Multi-node plugins

Plugins that need multiple nodes register all of them in `register`:

```ts
export function register(dispatcher: RipperDagonizer<ScrapeState>): void {
  dispatcher.registerNode(parseNode);
  dispatcher.registerNode(finalizeNode);
  dispatcher.registerDAG(myPluginDAG);
}
```

When a pipeline step resolves to a registered DAG name, the runner places an embedded DAG and wires its output mapping so downstream steps (e.g. `json:write`) see the parsed record.

## Testing a plugin in isolation

Register the node and its DAG on a `Dagonizer` instance and call `dispatcher.execute('dag:name', state)`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Dagonizer } from '@studnicky/dagonizer';
import { ScrapeState } from 'ripperoni/state/ScrapeState';
import { myParseNode, myParseFlow } from './my-plugin.js';

describe('mysite:parse', () => {
  it('extracts name from h1.title', async () => {
    const dispatcher = new Dagonizer<ScrapeState, undefined>({ services: undefined });
    dispatcher.registerNode(myParseNode);
    dispatcher.registerDAG(myParseFlow);

    const state = new ScrapeState();
    state.page = {
      targetId: 'mysite',
      title: '',
      url: 'https://example.com/page',
      html: '<h1 class="title">Hello</h1>',
    };

    await dispatcher.execute('mysite:parse', state);

    assert.equal(state.output?.['name'], 'Hello');
  });
});
```

No network, no file system — just the extraction logic running through its 1-node DAG.

## AONPRD plugin (built-in example)

The `plugins/aonprd/` directory ships a full-featured example plugin that parses Archives of Nethys (2e.aonprd.com) HTML. It demonstrates URL-based concept dispatch via a taxonomy, shared extraction helpers, per-concept structured output, and fixture-based unit tests. It is the reference implementation for a production-grade plugin.

The entry point `plugins/aonprd/parse.task.ts` exports `register(dispatcher)`, which iterates all taxonomy-compiled nodes via `TAXONOMY.allNodes()`, registers them, then registers the `aonprd:parse` DAG on the dispatcher.

See [Architecture](/architecture) for the DAG topology and `plugins/aonprd/parse.task.ts` for the reference implementation.

## Related

- [Orchestration](/usage/pipeline) — how the DAG dispatch works
- [Scrapers](/usage/scrapers) — what state.page looks like per scraper type
- [MediaWiki](/usage/mediawiki) — wiki-specific state
- [Configuration](/usage/configuration) — how to declare pipeline steps in config
