---
layout: doc
title: Pipeline
---

# Pipeline

The pipeline is a typed async middleware queue. Tasks receive `(next, state)`. Call `next()` to hand off; skip it to terminate the chain early.

```ts
type TaskFnType<TState> = (next: () => Promise<void>, state: TState) => Promise<void>
```

`TState` extends `Record<string, unknown>`. Tasks mutate state directly — the same reference flows through the whole chain.

## TaskRegistry

Tasks are registered by name and resolved at pipeline build time.

```ts
import { TaskRegistry } from 'ripperoni/registry/TaskRegistry';

// Self-registration at import time (the standard pattern)
TaskRegistry.register('mywiki:parse', async (next, state) => {
  // ... extract data from state.input.html or state.input.wikitext ...
  state.output = { /* your record */ };
  await next();
});
```

Built-in tasks (`html:fetch`, `json:write`) are pre-registered. Plugin tasks register themselves when loaded.

Load a plugin file dynamically:

```ts
await TaskRegistry.load('./plugins/mywiki.js');
```

The module's top-level `TaskRegistry.register(...)` calls fire on import.

## State shape

```ts
interface PipelineStateInterface {
  targetId: string;              // target or mediawiki block name
  source:   InputSourceInterface;
  input:    Record<string, unknown>;  // populated by html:fetch / wiki scraper
  output:   Record<string, unknown> | null;  // populated by your parse task
  // ... plus any extra keys tasks attach
}
```

`state.input.html` — raw HTML string, set by `html:fetch`.
`state.input.wikitext` — raw wikitext string, set by wiki fetch.
`state.input.url` — the URL fetched.

`state.output` — set by your parse task. `json:write` serializes this to disk.

Tasks can attach extra keys using the `Record<string, unknown>` index signature. This is how tasks pass data to each other without coupling to canonical fields.

## Built-in tasks

| Name | What it does |
|------|-------------|
| `html:fetch` | Rate-limited fetch with retry + backoff. Reads from cache on hits. Sets `state.input.html`. |
| `json:write` | Writes `state.output` to `<basePath>/<target>/<slug>.json`. |

## The parse task pattern

Your plugin's task is the only domain-specific code you write. It receives `state.input.html` (or `state.input.wikitext` for wiki targets) and sets `state.output`:

```ts
import type { CheerioAPI } from 'cheerio';
import * as cheerio from 'cheerio';

TaskRegistry.register('mysite:parse', async (next, state) => {
  const html = state.input['html'] as string;
  const url  = state.input['url'] as string;
  const $    = cheerio.load(html);

  state.output = {
    _type:  'article',
    url,
    title:  $('h1').first().text().trim(),
    body:   $('#content').text().trim(),
    _source: { target: state.targetId, url, plugin: 'mysite:parse' },
  };

  await next();
});
```

No HTTP in the plugin. No file I/O in the plugin. The pipeline handles both. Your plugin just reads the HTML and writes a record.

## Ordering

```
html:fetch  →  mysite:parse  →  json:write
```

`html:fetch` must come first. `json:write` must come last. Your parse task goes in between.

For wiki targets, the orchestrator handles the fetch — your task receives a pre-populated `state.input` and sets `state.output`. The write task is always added last by the orchestrator.

## ScrapeOrchestrator

You don't build the pipeline directly — the `ScrapeOrchestrator` builds it per page from the target config. It:

1. Resolves the target's `pipeline` array against the registry.
2. Optionally prepends the fetch task.
3. Appends the write task.
4. Calls `pipeline.execute(state)` for each page URL or wiki page.

If you want to run a pipeline directly in code (tests, scripts):

```ts
import { Pipeline } from 'ripperoni/pipeline/Pipeline';
import { PipelineState } from 'ripperoni/registry/PipelineState';

const pipeline = new Pipeline<PipelineStateInterface>({ name: 'mysite' });
pipeline.addTaskByName('mysite:parse');
pipeline.addTask(async (next, state) => { console.log(state.output); await next(); });

await pipeline.execute(PipelineState.fromHtmlPage('mysite', url, html));
```

## The _type discriminator convention

Put a `_type` field on every output record. Downstream tools use it for classification. The `_source` block makes records traceable back to their origin:

```ts
state.output = {
  _type:   'spell',              // discriminator
  url,
  name,
  level,
  _source: {
    target: state.targetId,
    url,
    plugin: 'mywiki:parse',
  },
};
```

## Related

- [Configuration](./configuration) — pipeline declaration in config
- [Scrapers](./scrapers) — what html:fetch hands your plugin
- [MediaWiki](./mediawiki) — wiki-specific state shape
- [Plugins](./plugins) — full plugin authoring guide
