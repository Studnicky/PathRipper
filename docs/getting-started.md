# Getting Started

Ripperoni scrapes websites and produces typed JSON. Point it at a site; it crawls pages, runs them through a pipeline of tasks, and writes structured output. Every scrape is a DAG (directed acyclic graph) executed by [@studnicky/dagonizer](https://github.com/Studnicky/Dagonizer) — the graph engine that drives all task ordering and concurrency.

## Install

```bash
git clone https://github.com/Studnicky/Ripperoni.git
cd Ripperoni
npm install
npm run build
```

## Configure a target — stuff the casing

Copy `ripperoni.config.example.json` to `ripperoni.config.json` and edit.
The unprefixed file is gitignored — it holds your real targets.

```json
{
  "output": { "basePath": "./output", "format": "json", "pretty": true },
  "mediawiki": {
    "your-wiki-target": {
      "apiUrl":      "https://wiki.example/w/api.php",
      "rateLimitMs": 2000,
      "jitterMs":    500,
      "batchSize":   50,
      "categories":  ["Example Category A", "Example Category B"],
      "pipeline":    ["wiki:fetch", "your-wiki-target:parse", "json:write"],
      "cache":       { "dir": "./output/.cache/your-wiki-target", "mode": "read-write" }
    }
  },
  "targets": {
    "your-html-target": {
      "baseUrl":     "https://example.com",
      "rateLimitMs": 500,
      "pipeline":    ["html:fetch", "your-html-target:parse", "json:write"],
      "cache":       { "dir": "./output/.cache/your-html-target", "mode": "read-write" },
      "crawler": {
        "startUrls": ["https://example.com/index"],
        "domain":    "example\\.com",
        "target":    "\\?id=",
        "delimiter": "category",
        "rateLimitMs": 100,
        "jitterMs":    25
      }
    }
  }
}
```

The `pipeline` array lists task identifiers (strings resolved from the node registry) that run in order for each page. Built-in tasks: `html:fetch`, `wiki:fetch`, and `json:write`. A plugin (a loadable module that adds custom parse logic) registers `<targetId>:parse` (or whatever name it uses).

A target is a named scrape configuration — one entry per site or wiki. The `crawler` block lives inside a target and drives URL discovery before the pipeline runs.

## Run your first scrape

`scrape` detects HTML or MediaWiki mode from the config section the target name appears under.

```bash
ripperoni scrape \
  --target your-html-target \
  --config ripperoni.config.json
```

Pass `--paths` to pin specific paths — the crawl phase is skipped:

```bash
ripperoni scrape \
  --target your-html-target \
  --paths "/page/1" "/page/2" \
  --config ripperoni.config.json
```

For a MediaWiki target, pass `--category` to scrape a single category:

```bash
ripperoni scrape \
  --target your-wiki-target \
  --category "Example Category Name" \
  --config ripperoni.config.json
```

Omit `--category` to fall through to the `categories` array from config, or to enumerate every article via the allpages API.

Use `--resume-failures` to re-scrape pages listed in `failures.json` from the last run. Use `--out <dir>` to override the output directory.

### Explicit mode commands

`scrape-html` and `scrape-wiki` target a specific mode directly:

```bash
ripperoni scrape-html --target your-html-target --paths "/page/1" "/page/2"
ripperoni scrape-wiki --target your-wiki-target --category "Feats"
```

## Discover URLs with the crawler

`crawl` discovers and prints target URLs — the crawler is the link-following component that finds pages before the pipeline processes them. Run it before committing a scrape config to verify coverage.

```bash
ripperoni crawl \
  --starts "https://example.com/index" \
  --domain "example\.com" \
  --target "\?id=" \
  --delimiter "category" \
  --rate 100 \
  --jitter 25 \
  --max 500
```

`--starts` accepts multiple URLs. `--rate` and `--jitter` are milliseconds. `--max` caps total URLs collected.

## Write a parse plugin — bring your own blade

Plugins live under `plugins/<targetId>/`. Each plugin module exports a `register(dispatcher)` function that registers its nodes and any embedded DAGs (task sub-graphs wired inside the plugin). The runner imports `./plugins/<targetId>/parse.task.js` when the pipeline config lists `<targetId>:parse`.

Nodes are `ScalarNode` subclasses. `executeOne` returns `NodeOutputBuilder.of('<port>')`.

```ts
// plugins/my-target/parse.task.ts
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';
import type { RipperDagonizer } from '../../src/dispatcher/RipperDagonizer.js';
import type { RipperServices }  from '../../src/services/RipperServices.js';
import type { ScrapeState }     from '../../src/state/ScrapeState.js';

type MyOutput = 'success' | 'error';

class MyParseNodeImpl extends ScalarNode<ScrapeState, MyOutput, RipperServices> {
  public readonly name    = 'my-target:parse';
  public readonly outputs = ['success', 'error'] as const;

  protected override async executeOne(
    state:   ScrapeState,
    _ctx:    NodeContextType<RipperServices>,
  ): Promise<NodeOutputType<MyOutput>> {
    const html = state.page.html ?? '';
    if (html.length === 0) return NodeOutputBuilder.of('error');

    state.output = {
      url:   state.page.url,
      title: state.page.title,
      // ... your structured fields
    };
    return NodeOutputBuilder.of('success');
  }
}

const MyParseNode = new MyParseNodeImpl();

export function register(dispatcher: RipperDagonizer<ScrapeState>): void {
  dispatcher.registerNode(MyParseNode);
}
```

## Further reading

- [Architecture](./architecture): pipeline, HTTP machinery, scrapers, source map
- [Roadmap](./roadmap): what shipped, what's planned
