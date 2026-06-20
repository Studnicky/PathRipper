# Getting Started

Ripperoni is not on npm yet. Clone the repo, install, and build.

## Install

```bash
git clone https://github.com/Studnicky/Ripperoni.git
cd Ripperoni
npm install
npm run build
```

## Create a config

Copy `ripperoni.config.example.json` to `ripperoni.config.json` and edit.
The unprefixed file is gitignored; it holds your real targets.

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
      "baseUrl":     "https://example.com",
      "rateLimitMs": 500,
      "pipeline":    ["./plugins/your-target/parse.task.js"]
    }
  }
}
```

## Scrape a MediaWiki target

```bash
ripperoni scrape \
  --target <your-wiki-target> \
  --category "Example Category Name" \
  --config ripperoni.config.json
```

Omit `--category` to use the `categories` array from config, or to enumerate every article in the wiki via the allpages API. Writes one `.json` per page under `./output/<your-wiki-target>/`.

## Crawl a site for links

```bash
ripperoni crawl \
  --starts "https://example.com/index" \
  --domain "example\.com" \
  --target "\?id=" \
  --delimiter "category" \
  --rate 100
```

## Scrape HTML pages

```bash
ripperoni scrape \
  --target <your-html-target> \
  --paths "/page/1" "/page/2" \
  --config ripperoni.config.json
```

## Write a parse plugin

Plugins are TypeScript modules under `plugins/<targetId>/`. Each plugin exports a `register(dispatcher)` function that adds its nodes (and any sub-DAGs) to the runtime dispatcher. The runner imports the module from `./plugins/<targetId>/parse.task.js` automatically when the pipeline config lists `<targetId>:parse`.

```ts
// plugins/my-target/parse.task.ts
import type { NodeInterface, NodeContextInterface } from '@studnicky/dagonizer';
import type { RipperDagonizer } from '../../src/dispatcher/RipperDagonizer.js';
import type { RipperServices } from '../../src/services/RipperServices.js';
import type { ScrapeState } from '../../src/state/ScrapeState.js';

export const myParseNode: NodeInterface<ScrapeState, 'success' | 'error', RipperServices> = {
  name:    'my-target:parse',
  outputs: ['success', 'error'],
  async execute(state, _ctx) {
    const html = state.page.html ?? '';
    if (html.length === 0) return { output: 'error' };
    state.output = {
      url:   state.page.url,
      title: state.page.title,
      // ... your structured fields
    };
    return { output: 'success' };
  },
};

export function register(dispatcher: RipperDagonizer<ScrapeState>): void {
  dispatcher.registerNode(myParseNode);
}
```

## Where to look next

- [Architecture](./architecture): pipeline, HTTP machinery, scrapers, source map
- [Roadmap](./roadmap): what shipped, what's planned
