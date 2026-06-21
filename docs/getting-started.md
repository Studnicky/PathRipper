# Getting Started

Ripperoni scrapes websites and produces typed JSON. Every scrape is a directed acyclic graph (DAG) executed by [@studnicky/dagonizer](https://github.com/Studnicky/Dagonizer). Three artifacts drive a run: an orchestration DAG document, a state file, and one or more plugins.

## Install

```bash
git clone https://github.com/Studnicky/Ripperoni.git
cd Ripperoni
npm install
npm run build
```

## Scaffold a run

`ripperoni scaffold` writes a starter orchestration document and state file:

```bash
ripperoni scaffold mysite
```

This produces two files:

- `mysite.dag.jsonld` — the orchestration DAG (JSON-LD document).
- `mysite.state.json` — run parameters validated at startup.

## Edit the state file

`mysite.state.json` drives every runtime decision — what to fetch, how fast, where to write. All fields are validated by `RunStateSchema` before any network activity begins.

| Field | Type | Description |
|-------|------|-------------|
| `baseUrl` | string | Base URL; all relative paths resolve against this. |
| `apiUrl` | string | MediaWiki API endpoint (set when using `wiki:fetch`). |
| `rateLimitMs` | integer | Minimum milliseconds between requests. |
| `jitterMs` | integer | Random jitter added on top of `rateLimitMs` per request. |
| `maxRetries` | integer | Retry attempts on transient errors (0–10). |
| `retryBaseDelayMs` | integer | Base delay for retry backoff. |
| `retryMaxDelayMs` | integer | Backoff ceiling. |
| `headers` | object | Additional HTTP request headers. |
| `output.basePath` | string | Base directory for all written output files. |
| `output.format` | string | Output format: `"json"` (default) or `"jsonl"`. |
| `output.pretty` | boolean | Pretty-print JSON. Default `false`. |
| `output.splitByTaskName` | boolean | Partition output into per-task subdirectories. |
| `cache.dir` | string | Cache directory path. |
| `cache.mode` | string | `read-write`, `read-only`, `write-only`, or `off`. |
| `cache.ttlMs` | integer | Cache entry TTL in milliseconds. |
| `crawler.startUrls` | string[] | Seed URLs for the `crawl:discover` DAG. |
| `crawler.domain` | string | Regex; links must match to enter the crawl. |
| `crawler.target` | string | Regex; links matching `domain` + `delimiter` + `target` are collected. |
| `crawler.delimiter` | string | Regex; links matching `domain` + `delimiter` are followed as frontier pages. |
| `crawler.rateLimitMs` | integer | Crawler-specific rate limit (independent of scraper rate limit). |
| `crawler.jitterMs` | integer | Crawler-specific jitter. |
| `crawler.maxPages` | integer | Hard ceiling on collected target URLs. |
| `urls` | string[] | Explicit URL list; when present, the `crawl:discover` DAG is not needed. |
| `parallelWorkers` | boolean | Route scatter items to a `WorkerThreadContainer` pool. |
| `includeRawContent` | boolean | Include `_raw` field in output records. Default `true`. |
| `outputSchema` | string | Path to a JSON Schema file for record validation. |
| `onSchemaError` | string | `"halt"`, `"skip"`, or `"warn"` when schema validation fails. |

A concrete example using the full crawler flow:

```json
{
  "baseUrl": "https://example.com",
  "rateLimitMs": 500,
  "jitterMs": 100,
  "maxRetries": 3,
  "retryBaseDelayMs": 500,
  "retryMaxDelayMs": 30000,
  "headers": {
    "User-Agent": "mysite-scraper/1.0 (+https://github.com/me/mysite)"
  },
  "output": {
    "basePath": "./output",
    "format": "json",
    "pretty": true
  },
  "cache": {
    "dir": "./output/.cache/mysite",
    "mode": "read-write"
  },
  "crawler": {
    "startUrls": ["https://example.com/index"],
    "domain": "example\\.com",
    "target": "\\?id=",
    "delimiter": "category",
    "rateLimitMs": 100,
    "jitterMs": 25,
    "maxPages": 500
  }
}
```

To scrape a fixed list of URLs without crawling, use `urls` instead of the `crawler` block:

```json
{
  "baseUrl": "https://example.com",
  "rateLimitMs": 250,
  "output": { "basePath": "./output" },
  "cache": { "dir": "./output/.cache/mysite", "mode": "read-write" },
  "urls": [
    "https://example.com/items/42",
    "https://example.com/items/99"
  ]
}
```

## Author the orchestration DAG

`mysite.dag.jsonld` is a JSON-LD document describing one dagonizer DAG. It wires the run at the orchestration level — embedding the `crawl:discover` DAG, scattering over collected URLs, and delegating per-page work to a plugin DAG.

A crawler-first orchestration looks like this:

```json
{
  "@context": { ... },
  "@type": "DAG",
  "name": "mysite:crawl",
  "version": "1.0",
  "entrypoint": "discover",
  "nodes": [
    {
      "@type": "EmbeddedDAGNode",
      "name": "discover",
      "dag": "crawl:discover",
      "stateMapping": {
        "output": { "urls": "crawl.discovered" }
      },
      "outputs": {
        "success": "scrape",
        "error": "crawl-failed"
      }
    },
    {
      "@type": "ScatterNode",
      "name": "scrape",
      "source": "urls",
      "body": { "dag": "mysite:page" },
      "container": "worker",
      "itemKey": "currentUrl",
      "gather": {
        "strategy": "partition",
        "partitions": { "success": "succeeded", "error": "failed" }
      },
      "reducer": "aggregate",
      "outputs": {
        "all-success": "done",
        "partial": "done",
        "all-error": "done",
        "empty": "done"
      }
    },
    {
      "@type": "TerminalNode",
      "name": "done",
      "outcome": "completed"
    },
    {
      "@type": "TerminalNode",
      "name": "crawl-failed",
      "outcome": "failed"
    }
  ]
}
```

The `EmbeddedDAGNode` with `dag: "crawl:discover"` runs the built-in link-crawler. Its `stateMapping` seeds `state.urls` from `crawl.discovered` after the crawl completes. The `ScatterNode` fans over `state.urls` and dispatches the plugin's `mysite:page` DAG once per URL. `container: "worker"` routes items to the parallel worker pool when `parallelWorkers: true` is set in state.

When no crawling is needed (a fixed `urls` list is in state), the orchestration starts at the scatter directly:

```json
{
  "@type": "DAG",
  "name": "mysite:scrape",
  "entrypoint": "scrape",
  "nodes": [
    {
      "@type": "ScatterNode",
      "name": "scrape",
      "source": "urls",
      "body": { "dag": "mysite:page" },
      "container": "worker",
      "itemKey": "currentUrl",
      "gather": { "strategy": "partition", "partitions": { "success": "succeeded", "error": "failed" } },
      "outputs": { "all-success": "done", "partial": "done", "all-error": "done", "empty": "done" }
    },
    { "@type": "TerminalNode", "name": "done", "outcome": "completed" }
  ]
}
```

## Write a plugin

Plugins live under `plugins/<namespace>/`. Each plugin exports `register(dispatcher)` and provides one or more `*.dag.jsonld` files for its DAGs.

### The per-page DAG

The per-page DAG declares the node chain each URL passes through. Author it with `DAGBuilder` and serialize it with `DAGDocument.serialize()`:

```ts
// plugins/mysite/page.dag.ts
import { DAGBuilder, DAGDocument } from '@studnicky/dagonizer';
import { HtmlFetchNode, JsonWriteNode } from '../../src/nodes/index.js';

const dag = new DAGBuilder('mysite:page', '1.0')
  .node('html:fetch', HtmlFetchNode, {
    success: 'mysite:parse',
    cached:  'mysite:parse',
    error:   'mysite-page:failed',
  })
  .embeddedDAG('mysite:parse', 'mysite:parse', {
    success: 'json:write',
    error:   'mysite-page:failed',
  })
  .node('json:write', JsonWriteNode, {
    success: 'mysite-page:completed',
    skipped: 'mysite-page:completed',
  })
  .terminal('mysite-page:completed', { outcome: 'completed' })
  .terminal('mysite-page:failed',    { outcome: 'failed' })
  .build();

// Run once to generate the committed file:
// DAGDocument.serialize(dag) → write to plugins/mysite/page.dag.jsonld
```

Commit the serialized `page.dag.jsonld` alongside the plugin source. The runner loads `*.dag.jsonld` files automatically at startup.

### The parse node

Parse nodes are `ScalarNode` subclasses. `executeOne` reads from `state.page` and writes to `state.output`:

```ts
// plugins/mysite/parse.task.ts
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';
import type { RipperDagonizer } from '../../src/dispatcher/RipperDagonizer.js';
import type { RipperServices }  from '../../src/services/RipperServices.js';
import type { ScrapeState }     from '../../src/state/ScrapeState.js';

class MyParseNodeImpl extends ScalarNode<ScrapeState, 'success' | 'error', RipperServices> {
  public readonly name    = 'mysite:parse-impl';
  public readonly outputs = ['success', 'error'] as const;

  protected override async executeOne(
    state:   ScrapeState,
    _ctx:    NodeContextType<RipperServices>,
  ): Promise<NodeOutputType<'success' | 'error'>> {
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

export const MyParseNode = new MyParseNodeImpl();
```

### The register function

`index.ts` exports `register(dispatcher)`. It registers node instances only — DAGs come from `*.dag.jsonld` files:

```ts
// plugins/mysite/index.ts
import type { RipperDagonizer } from '../../src/dispatcher/RipperDagonizer.js';
import type { ScrapeState }     from '../../src/state/ScrapeState.js';
import { MyParseNode } from './parse.task.js';

export function register(dispatcher: RipperDagonizer<ScrapeState>): void {
  dispatcher.registerNode(MyParseNode);
}
```

The runner discovers the plugin by walking the orchestration DAG's `EmbeddedDAGNode.dag` and `ScatterNode.body.dag` references, derives the namespace from the prefix before `:`, and loads `plugins/<namespace>/index.js` plus all `*.dag.jsonld` files in that directory.

## Run it

```bash
ripperoni run mysite.dag.jsonld --state mysite.state.json
```

Pass `--out <dir>` to override `output.basePath` from the state file for a single run.

Output lands in `output.basePath/<targetId>/` (or per-task subdirectories when `splitByTaskName` is true). Failed pages land in `failures.json` in the same directory. Re-run against a failures list by setting `urls` in a fresh state file pointing at the failed URLs.

## Further reading

- [Architecture](./architecture): DAG topology, HTTP machinery, scrapers, source map
- [Authoring a DAG](./usage/pipeline): placement types, `DAGBuilder` API, built-in nodes
- [Configuration](./usage/configuration): full `state.json` field reference
- [Plugins](./usage/plugins): node contract, services bag, testing
- [Roadmap](./roadmap): what shipped, what is planned
