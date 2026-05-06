# Ripperoni

[![CI](https://github.com/Studnicky/PathRipper/actions/workflows/ci.yml/badge.svg)](https://github.com/Studnicky/PathRipper/actions/workflows/ci.yml)
[![docs](https://img.shields.io/badge/docs-studnicky.github.io-c8284a)](https://studnicky.github.io/PathRipper/)
[![node](https://img.shields.io/badge/node-%3E%3D24.0.0-brightgreen)](package.json)
[![version](https://img.shields.io/badge/version-2.1.0-c8284a)](CHANGELOG.md)

Web ingestion engine. Point it at a wiki, a site, or a list of URLs. It slices through everything, one page at a time, and hands you the meat.

**Next step:** Ripperoni produces JSON records. Feed them into [Squashage](https://github.com/Studnicky/Squashage) to graph-squash them into deterministic RDF.

Evolved from [PathRipper](https://github.com/Studnicky/PathRipper) (2019). HTTP machinery ported from TORUS (Topological Orchestration Runtime for Unified Streaming), an upcoming streaming DAG orchestration tool currently under development.

**[Documentation](https://studnicky.github.io/PathRipper/)** · **[Architecture](https://studnicky.github.io/PathRipper/architecture)** · **[Roadmap](https://studnicky.github.io/PathRipper/roadmap)** · **[Releases](https://github.com/Studnicky/PathRipper/releases)**

---

## Requirements

- Node 24+
- TypeScript 5.7+

## Install

```bash
npm install
npm run build
```

## Quickstart

```bash
# Scrape a MediaWiki target: one category
ripperoni scrape \
  --target <your-wiki-target> \
  --category "Example Category Name" \
  --config ripperoni.config.json

# Scrape all pages in a wiki (no --category = enumerate via allpages API)
ripperoni scrape \
  --target <your-wiki-target> \
  --config ripperoni.config.json

# Scrape HTML pages
ripperoni scrape \
  --target <your-html-target> \
  --paths "/page/1" "/page/2" \
  --config ripperoni.config.json

# Crawl a site for links matching a pattern
ripperoni crawl \
  --starts "https://example.com/index" \
  --domain "example\.com" \
  --target "\?id=" \
  --delimiter "category"
```

Copy `ripperoni.config.example.json` to `ripperoni.config.json` and edit. The unprefixed file is gitignored; it holds your real targets.

## Scripts

```bash
npm run build       # compile TypeScript + plugins
npm run typecheck   # tsc --noEmit
npm run lint        # eslint src/
npm run check       # typecheck + lint + unit tests
npm run docs:build  # build VitePress docs
npm run test:e2e    # local e2e against live targets (not run by CI)
```

## Config

All scraper targets live in `ripperoni.config.json` (the project itself names no targets):

```json
{
  "output": { "basePath": "./output" },
  "mediawiki": {
    "<your-wiki-target>": {
      "apiUrl":      "https://wiki.example/w/api.php",
      "rateLimitMs": 1000,
      "categories":  ["Category A", "Category B"],
      "pipeline":    ["./plugins/your-target/parse.task.js"]
    }
  },
  "targets": {
    "<your-html-target>": {
      "baseUrl":  "https://example.com",
      "rateLimitMs": 500,
      "tasks":    ["./plugins/your-target/parse.task.js"]
    }
  }
}
```

`categories` is optional; omit it to scrape every article in the wiki via the allpages API. `tasks` points at user-written parse plugins that run through the pipeline before each page is written.

The config is validated on load against the internal JSON Schema; malformed files fail fast with a precise field-path error message.

See the [config reference](https://studnicky.github.io/PathRipper/getting-started) for the full reference.

## Plugins

Parse plugins are `.js` files you write and point at from the config. Each plugin registers a task under the name `<targetId>:parse`:

```js
// plugins/my-target/parse.task.js
import { TaskRegistry } from 'ripperoni/registry/TaskRegistry';

TaskRegistry.register('my-target:parse', async (next, state) => {
  const wikitext = state.page.wikitext;
  // parse and set structured output
  state.output = { title: state.page.title, /* ... */ };
  await next();
});
```

Build plugins from TypeScript source with `npm run build:plugins` (requires `tsconfig.plugins.json`).

## Programmatic

```typescript
import { Pipeline } from 'ripperoni/Pipeline';
import { MediaWikiScraper } from 'ripperoni/MediaWikiScraper';
import { WikitextParser } from 'ripperoni/WikitextParser';

const scraper = await MediaWikiScraper.create({
  apiUrl:      'https://wiki.example/w/api.php',
  rateLimitMs: 1000,
});

const pages = await scraper.scrapeCategory('Example Category Name');

const pipeline = new Pipeline({ name: 'my-job' });
pipeline.addTask(async (next, state) => {
  state.output = WikitextParser.parse(state.page.title, state.page.wikitext ?? '');
  await next();
});

await pipeline.execute({ targetId: 'my-target', page: pages[0], output: null });
```

## License

UNLICENSED
