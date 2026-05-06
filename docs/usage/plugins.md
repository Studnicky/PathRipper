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

## Related

- [Pipeline](./pipeline); how the task queue works
- [Scrapers](./scrapers); what state.input looks like per scraper type
- [MediaWiki](./mediawiki); infobox helpers and wiki-specific state
- [Configuration](./configuration); how to declare plugins in config
