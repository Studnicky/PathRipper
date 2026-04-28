# Ripperoni

Configurable web scraper. Pluggable pipeline tasks, HTML and MediaWiki modes, recursive link crawler, retry logic, rate limiting.

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
# Scrape a MediaWiki category
ripperoni scrape-wiki \
  --target <your-wiki-target> \
  --category "Example Category Name" \
  --config ripperoni.config.json

# Crawl a site for links matching a pattern
ripperoni crawl \
  --start "https://example.com/index" \
  --domain "example\.com" \
  --target "\?id=" \
  --delimiter "category"

# Scrape HTML pages
ripperoni scrape-html \
  --target <your-html-target> \
  --paths "/page/1" "/page/2" \
  --config ripperoni.config.json
```

Copy `ripperoni.config.example.json` to `ripperoni.config.json` and edit. The unprefixed file is gitignored — it holds your real targets.

## Scripts

```bash
npm run build       # compile TypeScript
npm run typecheck   # tsc --noEmit
npm run lint        # eslint src/
npm run lint:fix    # eslint --fix
npm run test        # node --test
npm run check       # typecheck + lint + test
```

## Config

All scraper targets live in `ripperoni.config.json` (the project itself names no targets):

```json
{
  "output": { "basePath": "./output" },
  "mediawiki": {
    "<your-wiki-target>": {
      "apiUrl":      "https://wiki.example/w/api.php",
      "userAgent":   "MyApp/1.0 (you@example.com)",
      "rateLimitMs": 1000
    }
  },
  "targets": {
    "<your-html-target>": { "baseUrl": "https://example.com", "rateLimitMs": 500 }
  }
}
```

The config file is validated on load against the internal JSON Schema; malformed files fail fast with a precise error message.

See [docs/index.html#config](docs/index.html#config) for the full reference.

## Programmatic

```typescript
import { Pipeline, MediaWikiScraper, WikitextParser, exportJson } from 'ripperoni';

const scraper = await MediaWikiScraper.create({
  apiUrl:      'https://wiki.example/w/api.php',
  userAgent:   'MyApp/1.0 (you@example.com)',
  rateLimitMs: 1000,
});

const pages = await scraper.scrapeCategory('Example Category Name');

const pipeline = new Pipeline({ name: 'my-job' });
pipeline.addTask(async (next, state) => {
  state.data = pages.map((p) => WikitextParser.parse(p.title, p.wikitext));
  await next();
});
pipeline.addTask(exportJson);

await pipeline.execute({ outputPath: './output/result.json', data: null });
```

## License

UNLICENSED
