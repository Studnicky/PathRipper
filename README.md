# Ripperoni

Configurable web scraper. Plugin-driven pipeline tasks, HTML and MediaWiki modes, recursive link crawler, retry logic, rate limiting.

Evolved from [PathRipper](https://github.com/Studnicky/PathRipper) (2019). HTTP machinery ported from [Torus](https://github.com/Studnicky/torus).

**[Documentation](docs/index.html)** · **[Architecture](docs/architecture.html)** · **[Roadmap](docs/roadmap.html)**

---

## Requirements

- Node 20+
- TypeScript 5.7+

## Install

```bash
npm install
npm run build
```

## Quickstart

```bash
# Scrape a MediaWiki target — one category
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

Copy `ripperoni.config.example.json` to `ripperoni.config.json` and edit. The unprefixed file is gitignored — it holds your real targets.

## Scripts

```bash
npm run build       # compile TypeScript + plugins
npm run typecheck   # tsc --noEmit
npm run lint        # eslint src/
npm run check       # typecheck + lint + unit tests
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
      "tasks":       ["./plugins/your-target/parse.task.js"]
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

`categories` is optional — omit it to scrape every article in the wiki via the allpages API. `tasks` points at user-written parse plugins that run through the pipeline before each page is written.

The config is validated on load against the internal JSON Schema; malformed files fail fast with a precise field-path error message.

See [docs/index.html#config](docs/index.html#config) for the full reference.

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
