---
layout: doc
title: Plugins
---

# Plugins

A plugin teaches Ripperoni how to turn one site's HTML or wikitext into typed JSON. Each plugin is a dagonizer node — a `ScalarNode` subclass (from [@studnicky/dagonizer](https://github.com/Studnicky/Dagonizer)) — that you register on the run's dispatcher. The dispatcher is the object that owns node and DAG registration, routes state through them, and wires outputs to downstream steps. A plugin exports a `register` function. The runner imports the file, calls `register(dispatcher)`, and your nodes join the run. All wiring is explicit and scoped to the dispatcher the runner passes in.

## Plugin contract

Every plugin's `index.ts` (or `index.js`) must export:

```ts
export function register(dispatcher: RipperDagonizer<ScrapeState>): void
```

`register` calls `dispatcher.registerNode(...)` for each node instance. It does **not** call `dispatcher.registerDAG` — DAGs come from `*.dag.jsonld` files in the plugin directory, loaded automatically by `PluginLoader` at startup.

A missing `register` export aborts the run with an error at startup.

## Plugin discovery

`PluginLoader.registerPluginsFromEntry` walks the orchestration DAG's `EmbeddedDAGNode.dag` and `ScatterNode.body.dag` references. For each reference, it derives the namespace (the prefix before `:`), then:

1. Loads `plugins/<namespace>/index.js` and calls `register(dispatcher)`.
2. Loads all `*.dag.jsonld` files from `plugins/<namespace>/` in registration order (leaves first, via `PluginLoader.pluginDagsInRegistrationOrder`) and calls `dispatcher.registerDAG(dag)` for each.

Built-in nodes and DAGs (those with `BUILTIN_PREFIXES`) are registered first by `PluginLoader.registerBuiltinNodes` before any plugin is loaded.

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

In the per-page DAG any non-success port typically routes to a failed terminal and ends processing for that item.

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
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';
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

export function register(dispatcher: RipperDagonizer<ScrapeState>): void {
  dispatcher.registerNode(myParseNode);
}
```

The parse DAG for this node is authored separately with `DAGBuilder`, serialized, and committed as `plugins/mysite/parse.dag.jsonld`. The runner loads it from disk.

## MediaWiki plugin example

```ts
import wtf from 'wtf_wikipedia';

import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';
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

export function register(dispatcher: RipperDagonizer<ScrapeState>): void {
  dispatcher.registerNode(myWikiNode);
}
```

## Multi-node plugins

Plugins that need multiple nodes register all of them in `register`:

```ts
export function register(dispatcher: RipperDagonizer<ScrapeState>): void {
  dispatcher.registerNode(parseNode);
  dispatcher.registerNode(finalizeNode);
  // DAGs are loaded from *.dag.jsonld files — do not registerDAG here
}
```

## Testing a plugin in isolation

Register the node and load its DAG on a `Dagonizer` instance, then call `dispatcher.execute('dag:name', state)`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Dagonizer } from '@studnicky/dagonizer';
import { ScrapeState } from 'ripperoni/state/ScrapeState';
import { myParseNode } from './parse.task.js';
import myParseDAG from './parse.dag.jsonld' with { type: 'json' };

describe('mysite:parse', () => {
  it('extracts name from h1.title', async () => {
    const dispatcher = new Dagonizer<ScrapeState, undefined>({ services: undefined });
    dispatcher.registerNode(myParseNode);
    dispatcher.registerDAG(myParseDAG);

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

No network, no file system — just the extraction logic running through its node DAG.

## Concept taxonomy compiler

Plugins that dispatch per-concept use the shared taxonomy compiler in `src/taxonomy/`. Call `Taxonomy.compile(concepts, options)` where `options: { namespace, pathExtractor }` — it returns per-concept capability chains, a `routeUrl` classifier, `chainFor`, `allNodes`, and `buildDAG`. The router nodes (`makeTaxonomyRouter`, `makeConceptDispatch`) live in `TaxonomyRouterNodes.ts`; extraction strategy interfaces (`CommonStrategy`, `SourceRef`, `LinkRef`, `Section`) in `ExtractionStrategy.ts`. Node names are namespaced: `<namespace>:taxonomy-route`, `<namespace>:concept-dispatch`, etc.

`aonprd` and `dnd5e` are the two current implementations. AONPRD classifies by URL (`.aspx` path segments encode the concept type). D&D 5e classifies by page content (dandwiki URLs carry no type signal). Both compile from the same module; neither duplicates the other's taxonomy infrastructure.

## AONPRD plugin (built-in example)

The `plugins/aonprd/` directory ships a full-featured example plugin that parses Archives of Nethys (2e.aonprd.com) HTML. It demonstrates URL-based concept dispatch via the taxonomy compiler, shared extraction helpers, per-concept structured output, and fixture-based unit tests. It is the reference implementation for a production-grade plugin.

The entry point `plugins/aonprd/index.ts` exports `register(dispatcher)`, which iterates all taxonomy-compiled nodes via `TAXONOMY.allNodes()` and registers them. The `aonprd:parse` DAG is loaded from `plugins/aonprd/parse.dag.jsonld` by the runner.

See [Architecture](/architecture) for the DAG topology and `plugins/aonprd/index.ts` for the reference implementation.

## D&D 5e plugin

`plugins/dnd5e/` parses dandwiki.com 5e SRD pages into typed JSON using the same shared taxonomy compiler with content-based classification. See the [D&D 5e Scraper DAG](/dnd5e-scraper-dag) for the full walkthrough, typed `SpellOutput` shape, and direct-call API.

## Related

- [Authoring a DAG](/usage/pipeline): placement types and `DAGBuilder` API
- [Scrapers](/usage/scrapers): what `state.page` looks like per scraper
- [MediaWiki](/usage/mediawiki): wiki-specific state
- [Configuration](/usage/configuration): `state.json` field reference
