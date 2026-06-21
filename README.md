# Ripperoni

[![CI](https://github.com/Studnicky/Ripperoni/actions/workflows/ci.yml/badge.svg)](https://github.com/Studnicky/Ripperoni/actions/workflows/ci.yml)
[![docs](https://img.shields.io/badge/docs-studnicky.github.io-c8284a)](https://studnicky.github.io/Ripperoni/)
[![node](https://img.shields.io/badge/node-%3E%3D24.0.0-brightgreen)](package.json)
[![version](https://img.shields.io/badge/version-3.0.0-c8284a)](CHANGELOG.md)

Web ingestion engine. Point it at a wiki, a site, or a list of URLs. It slices through everything, one page at a time, and hands you the meat.

**Next step:** Ripperoni produces typed JSON records. Feed them into [Squashage](https://github.com/Studnicky/Squashage) to graph-squash them into deterministic RDF.

**[Documentation](https://studnicky.github.io/Ripperoni/)** · **[Architecture](https://studnicky.github.io/Ripperoni/architecture)** · **[Releases](https://github.com/Studnicky/Ripperoni/releases)**

---

## Built on Dagonizer

Ripperoni is built on [`@studnicky/dagonizer`](https://github.com/Studnicky/Dagonizer) — a DAG execution engine where every scrape job is a directed acyclic graph (a graph of steps with explicit edges, so the engine knows exactly which step runs next and can parallelize safely). Every target you configure compiles to a per-page DAG at runtime:

- The `pipeline` list in your config becomes a chain of nodes assembled by `DAGBuilder`.
- Each node is a `ScalarNode` subclass: it receives the shared `ScrapeState`, does its work, and returns a named output port that determines the next step.
- Pages fan out across the graph in parallel through Dagonizer's native scatter.
- Parse plugins drop in as **embedded DAGs** — a `DAGBuilder` 1-to-N node graph registered on the same dispatcher and wired into the pipeline by name.

You write the parse node. The engine runs it on every page.

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
# Auto-detect target type from config (html or mediawiki)
ripperoni scrape \
  --target aonprd \
  --config ripperoni.config.json

# Scrape a MediaWiki category
ripperoni scrape-wiki \
  --target my-wiki \
  --category "Example Category" \
  --config ripperoni.config.json

# Scrape specific HTML paths
ripperoni scrape-html \
  --target my-site \
  --paths "/page/1" "/page/2" \
  --config ripperoni.config.json

# Crawl a site for matching links
ripperoni crawl \
  --starts "https://example.com/index" \
  --domain "example\.com" \
  --target "\?id=" \
  --delimiter "category"
```

Copy `ripperoni.config.example.json` to `ripperoni.config.json` and edit. The unprefixed file is gitignored; it holds your real targets.

### CLI flags

| Command | Flags |
|---------|-------|
| `scrape` | `--target` (required), `--config`, `--out`, `--paths`, `--category`, `--resume-failures` |
| `scrape-html` | `--target` (required), `--paths` (required), `--config`, `--out` |
| `scrape-wiki` | `--target` (required), `--config`, `--out`, `--category`, `--resume-failures` |
| `crawl` | `--starts` (required), `--domain` (required), `--target` (required), `--delimiter` (required), `--rate`, `--jitter`, `--max` |

## Scripts

```bash
npm run build         # compile TypeScript + plugins + workers
npm run typecheck     # tsc --noEmit
npm run lint          # eslint src/
npm run check         # typecheck + lint + unit tests
npm run docs:build    # build VitePress docs
npm run test:e2e      # local e2e against live targets (not run by CI)
```

## Config

All scraper targets live in `ripperoni.config.json`. The `pipeline` field is an ordered list of task identifiers — built-ins like `html:fetch` and `json:write` plus your plugin steps.

```json
{
  "output": {
    "basePath": "./output",
    "format": "json",
    "pretty": true
  },
  "mediawiki": {
    "your-wiki-target": {
      "apiUrl":           "https://wiki.example/w/api.php",
      "rateLimitMs":      2000,
      "jitterMs":         500,
      "batchSize":        50,
      "categories":       ["Example Category A", "Example Category B"],
      "pipeline":         ["wiki:fetch", "your-wiki-target:parse", "json:write"],
      "cache":            { "dir": "./output/.cache/your-wiki-target", "mode": "read-write" }
    }
  },
  "targets": {
    "your-html-target": {
      "baseUrl":      "https://example.com",
      "rateLimitMs":  500,
      "pipeline":     ["html:fetch", "your-html-target:parse", "json:write"],
      "cache":        { "dir": "./output/.cache/your-html-target", "mode": "read-write" },
      "crawler": {
        "startUrls":  ["https://example.com/index"],
        "domain":     "example\\.com",
        "target":     "\\?id=",
        "delimiter":  "category",
        "rateLimitMs": 100,
        "maxPages":   500
      }
    }
  }
}
```

`categories` is optional on mediawiki targets; omit it to enumerate every article via the allpages API. The inline `crawler` block on an HTML target discovers page URLs automatically before the pipeline runs. Config is validated against an internal JSON Schema on load — malformed files fail fast with a precise field-path error.

See the [configuration reference](https://studnicky.github.io/Ripperoni/usage/configuration) for all fields.

## Plugins

A plugin teaches the engine how to parse one site's HTML or wikitext into a structured record. Each plugin is a TypeScript file that exports a `register(dispatcher)` function. The runner imports it, calls `register`, and your nodes join the run's dispatcher.

Nodes are `ScalarNode` subclasses from `@studnicky/dagonizer`. The subclass declares `name` and `outputs` as readonly fields, and implements `executeOne(state, context)` which returns `NodeOutputBuilder.of('<port>')`. To drop a parse step into the pipeline as an **embedded DAG**, wrap the node in a `DAGBuilder` 1-node graph and register both on the dispatcher.

```ts
// plugins/mysite/parse.task.ts
import { load } from 'cheerio';
import { ScalarNode, NodeOutputBuilder, DAGBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, DAGType } from '@studnicky/dagonizer';
import type { ScrapeState }     from 'ripperoni/state/ScrapeState';
import type { RipperServices }  from 'ripperoni/services/RipperServices';
import type { RipperDagonizer } from 'ripperoni/dispatcher/RipperDagonizer';

class MysiteParseNodeImpl extends ScalarNode<ScrapeState, 'success' | 'error', RipperServices> {
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

export const mysiteParseNode = new MysiteParseNodeImpl();

export const mysiteParseFlow: DAGType = new DAGBuilder('mysite:parse', '1.0')
  .entrypoint('mysite:parse-impl')
  .node('mysite:parse-impl', mysiteParseNode, { success: 'mysite:parse:done', error: 'mysite:parse:done' })
  .terminal('mysite:parse:done', { outcome: 'completed' })
  .build();

export function register(dispatcher: RipperDagonizer<ScrapeState>): void {
  dispatcher.registerNode(mysiteParseNode);
  dispatcher.registerDAG(mysiteParseFlow);
}
```

Wire the plugin into your config:

```json
{
  "targets": {
    "mysite": {
      "baseUrl":  "https://example.com",
      "pipeline": ["html:fetch", "mysite:parse", "json:write"]
    }
  }
}
```

The runner derives the file path from the non-built-in pipeline entry: `mysite:parse` → `./plugins/mysite/parse.task.js` relative to the config file. Build plugins with `npm run build:plugins`.

See [plugins reference](https://studnicky.github.io/Ripperoni/usage/plugins) for MediaWiki examples, multi-node plugins, and isolated unit testing patterns.

## Programmatic

The public subpath exports cover the building blocks. Config loading and scraper access:

```typescript
import { RipperConfig }      from 'ripperoni/RipperConfig';
import { MediaWikiScraper }  from 'ripperoni/MediaWikiScraper';
import { WikitextParser }    from 'ripperoni/WikitextParser';

// Load and validate a config file
const config = await RipperConfig.load('./ripperoni.config.json');

// Create a scraper directly
const scraper = await MediaWikiScraper.create({
  apiUrl:      'https://wiki.example/w/api.php',
  rateLimitMs: 1000,
});

// Fetch a category and parse wikitext
const members = await scraper.fetchCategory('Example Category');
const parsed  = WikitextParser.parse(members[0].title, members[0].wikitext ?? '');
```

Full subpath exports: `ripperoni/RipperConfig`, `ripperoni/MediaWikiScraper`, `ripperoni/HtmlScraper`, `ripperoni/WikitextParser`, `ripperoni/LinkLister`, `ripperoni/RateLimiter`, `ripperoni/Logger`, `ripperoni/nodes`, and the error types under `ripperoni/errors/*`.

## License

UNLICENSED
