# Architecture

Three independent concerns — **pipeline**, **HTTP machinery**, and **scrapers** — compose to produce a scraping job. Nothing in the pipeline knows about HTTP. Nothing in the HTTP layer knows about MediaWiki. The scraper classes are pure data accessors that return typed results.

## Module graph

```mermaid
graph TD
    CLI[cli/cli.ts] --> Pipeline
    CLI --> HtmlScraper
    CLI --> MediaWikiScraper
    CLI --> LinkLister
    CLI --> RipperConfig

    Pipeline[pipeline/Pipeline] --> Logger

    HtmlScraper[scrapers/HtmlScraper] --> RateLimiter
    HtmlScraper --> RetryExecutor
    HtmlScraper --> Logger

    MediaWikiScraper[scrapers/MediaWikiScraper] --> RateLimiter
    MediaWikiScraper --> Logger
    WikitextParser[scrapers/WikitextParser] -.uses.-> wtf_wikipedia

    LinkLister[crawlers/LinkLister] --> RateLimiter
    LinkLister --> RetryExecutor
    LinkLister --> Logger

    RetryExecutor[modules/http/RetryExecutor] --> ErrorClassifier
    RateLimiter[modules/http/RateLimiter] -.wraps.-> bottleneck
```

## Pipeline pattern

Typed async middleware chain where every task receives `(next, state)` and advances the queue by calling `next()`.

The core architecture is a typed middleware chain inherited from PathRipper's `Transformer` class, rewritten in TypeScript. Every task receives `(next, state)`. Calling `next()` advances to the next task; not calling it terminates the chain.

```mermaid
sequenceDiagram
    participant Caller
    participant Pipeline
    participant ParseTask as <targetId>:parse (plugin)
    participant WriteTask as write-to-disk (orchestrator)

    Caller->>Pipeline: execute(PipelineState)
    Pipeline->>ParseTask: (next, state)
    ParseTask-->>Pipeline: state.output set
    Pipeline->>WriteTask: (next, state)
    WriteTask-->>Pipeline: file written
    Pipeline-->>Caller: state
```

The `ScrapeOrchestrator` builds the pipeline per page. A user-registered `<targetId>:parse` task (from a plugin file declared in config) runs first and sets `state.output`. If no parse task is registered the orchestrator falls back to raw `WikitextParser` output. A write-to-disk task is always added last by the orchestrator.

```ts
const pipeline = new Pipeline<PipelineStateInterface>({ name: 'my-target' });
if (TaskRegistry.has('my-target:parse')) {
  pipeline.addTask(TaskRegistry.get('my-target:parse'));
}
pipeline.addTask(async (next, state) => {
  await next();
  await writeFile(outputPath, JSON.stringify(state.output ?? fallback));
});
await pipeline.execute(PipelineState.fromWikiPage('my-target', page));
```

### Task signature

```ts
type TaskFnType<TState> = (next: NextFnType, state: TState) => Promise<void>
```

`TState` must extend `Record<string, unknown>`. Tasks mutate state directly — the pipeline passes the same reference through the chain.

## HTTP machinery

Three composable classes — `RateLimiter`, `RetryExecutor`, and `ErrorClassifier` — form the HTTP stack, each injected independently.

Three classes form the HTTP stack, ported from TORUS (Topological Orchestration Runtime for Unified Streaming). They're independent of each other and compose by injection.

```mermaid
graph LR
    Request[fetch call] --> RateLimiter
    RateLimiter --> RetryExecutor
    RetryExecutor --> ErrorClassifier
    ErrorClassifier -->|retryable| RetryExecutor
    ErrorClassifier -->|permanent| Throw[throw]
    RetryExecutor -->|max attempts| Throw
    RetryExecutor -->|success| Response
```

### ErrorClassifier

Classifies errors into seven categories. Only NETWORK, THROTTLED, TIMEOUT, and TRANSIENT are retryable. Permanent 4xx errors immediately throw. Reads `Retry-After` header for THROTTLED back-off hint.

| Category | Retryable | Trigger |
|----------|-----------|---------|
| `NETWORK` | yes | `ECONNREFUSED`, `ECONNRESET`, `ENOTFOUND` |
| `TIMEOUT` | yes | `ETIMEDOUT`, `ESOCKETTIMEDOUT` |
| `THROTTLED` | yes | HTTP 429 · reads `Retry-After` |
| `TRANSIENT` | yes | HTTP 5xx |
| `PERMANENT` | no | HTTP 4xx (except 429) |
| `VALIDATION` | no | `TypeError`, `SyntaxError`, `ValidationError` |
| `RESOURCE` | no | `ENOMEM`, `ENOSPC` |

### RetryExecutor

Wraps any async function. On retryable error: waits, retries up to `maxAttempts`. Delay uses exponential backoff with ±10% decorrelated jitter to avoid thundering herd.

| Option | Default | Description |
|--------|---------|-------------|
| `maxAttempts` | `3` | Total attempts before throw (includes first try). |
| `baseDelayMs` | `500` | Base delay for attempt 1. |
| `multiplier` | `2` | Delay multiplier per attempt. |
| `maxDelayMs` | `30000` | Delay ceiling. |

### RateLimiter

Token-bucket backed by `bottleneck`. Factory methods: `RateLimiter.perSecond(n)` for throughput-based limits, `RateLimiter.withDelay(ms)` for fixed-gap limits. Used by every scraper and crawler.

## Scrapers

Pure data accessors for HTML (via cheerio) and MediaWiki (via native fetch) that return typed results without coupling to the pipeline.

### HtmlScraper

Native `fetch` + `cheerio`. Returns `ScrapedPageInterface { url, $, html }`. The `$` field is a live `CheerioAPI` handle — use it exactly as you'd use jQuery on a DOM. No browser engine, no JavaScript execution. For JS-rendered pages, swap the fetch call for a headless driver (Playwright, Puppeteer) and feed the HTML to `cheerio.load()`.

### MediaWikiScraper

Direct `fetch()` calls to the MediaWiki JSON API — no mwn or axios layer. Four operations:

- `fetchPage(title)` — single page wikitext
- `fetchPagesBatch(titles)` — up to 50 pages per API request
- `fetchCategory(name)` — paginated category members list
- `fetchAllPages()` — enumerates every article in main namespace via `action=query&list=allpages`

The `ScrapeOrchestrator` selects from three modes: explicit `--category` flag → single category; `categories[]` in config → iterate and deduplicate; no categories → `fetchAllPages()`. Rate limiting and jitter applied per-request.

### WikitextParser

Wraps `wtf_wikipedia`. `WikitextParser.parse(title, wikitext)` returns a `ParsedPageInterface` with `infobox` (flat key→value record), `sections` (title + raw wikitext), and `categories`. Helper methods `infoboxField` and `infoboxNumber` pull typed values without null-checks at call site.

## Link crawler

Recursive link crawler controlled by three regexes (`domain`, `delimiter`, `target`) that bound traversal and collect matching URLs.

Three regexes control behavior:

| Regex | Purpose |
|-------|---------|
| `domain` | Links must match to be considered at all. Keeps the crawler inside the target site. |
| `delimiter` | Links that match are traversed (followed). Links that don't are ignored entirely. |
| `target` | Links that match the delimiter AND this pattern are collected as results. Others are traversed but not returned. |

Visited URLs are tracked in a `Set`. All traversals run concurrently via `Promise.all` at each level. Results are deduplicated and sorted with a numeric-aware collator — so `Item-10` sorts after `Item-9`, not between `Item-1` and `Item-2`.

## Source map

Complete index of every source file, its exported symbols, and the PathRipper or TORUS module it was ported from.

| File | Exports | Ported from |
|------|---------|-------------|
| `src/pipeline/Pipeline.ts` | `Pipeline<TState>` | PathRipper `Transformer` |
| `src/modules/http/ErrorClassifier.ts` | `ErrorClassifier`, `ErrorCategory` | TORUS `errorClassifier.ts` |
| `src/modules/http/RetryExecutor.ts` | `RetryExecutor` | TORUS `RetryPolicyNode` |
| `src/modules/http/RateLimiter.ts` | `RateLimiter` | New — wraps `bottleneck` |
| `src/modules/logger/Logger.ts` | `Logger` | Torreya `@torreya/logger` |
| `src/scrapers/HtmlScraper.ts` | `HtmlScraper` | PathRipper `fetchPage`, cheerio replaces JSDOM |
| `src/scrapers/MediaWikiScraper.ts` | `MediaWikiScraper` | New — native `fetch()` to MediaWiki JSON API |
| `src/scrapers/WikitextParser.ts` | `WikitextParser` | New — `wtf_wikipedia` |
| `src/crawlers/LinkLister.ts` | `LinkLister` | PathRipper `linkLister/index.js` |
| `src/orchestrators/ScrapeOrchestrator.ts` | `ScrapeOrchestrator` | New — pipeline orchestration, three-mode wiki scrape |
| `src/registry/TaskRegistry.ts` | `TaskRegistry` | New — plugin registration and dynamic loading |
| `src/registry/PipelineState.ts` | `PipelineState` | New — typed state bridge between scrapers and plugins |
| `src/config/RipperConfig.ts` | `RipperConfig` | New — replaces hardcoded `config.js` |
| `src/cli/cli.ts` | `ripperoni` CLI | New — `commander` |
