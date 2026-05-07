import type { HtmlScraper } from '../scrapers/HtmlScraper.js';
import type { MediaWikiScraper } from '../scrapers/MediaWikiScraper.js';
import type { ScraperCache } from '../modules/cache/ScraperCache.js';

/**
 * Shared per-run pipeline context populated by the orchestrator before task execution.
 *
 * @remarks
 * Built-in tasks (e.g. `html:fetch`, `json:write`) read from this object; user
 * plugins are unaffected and continue using `state.page` / `state.output`.
 * Field is optional on {@link PipelineStateInterface} so existing callers
 * keep working — context-aware tasks check for it explicitly.
 *
 * @example
 * ```ts
 * const ctx: PipelineContextInterface = {
 *   target: 'pathfinder-monsters',
 *   outDir: '/tmp/scrape',
 *   scraper,
 *   config: { outputSchema: './schema.json' },
 * };
 * ```
 *
 * @category Pipeline
 * @since 2.0.0
 * @see {@link PipelineStateInterface}
 * @group Types
 */
export interface PipelineContextInterface {
  /** Scrape target identifier from the config. */
  readonly target:   string;
  /** Output base directory; tasks write under `<outDir>/<target>/...`. */
  readonly outDir:   string;
  /** Scraper instance used by fetch tasks; absent when not required. */
  readonly scraper?: HtmlScraper | MediaWikiScraper | undefined;
  /** Per-target configuration object as supplied by the loaded ripper config. */
  readonly config:   Record<string, unknown>;
  /** Optional shared content store; used by `crawl:list-targets` and any task that needs the same cache the scraper sees. */
  readonly cache?:   ScraperCache | undefined;
  /** Discovered target URLs (populated by `crawl:list-targets`); orchestrator iterates this when set. */
  targets?: ReadonlyArray<string>;
}

/**
 * Raw fetched content captured when `includeRawContent` is enabled on the target config.
 *
 * @remarks
 * Populated by the fetch task (`html:fetch` or `wiki:fetch`) when `config.includeRawContent` is
 * `true`. Carried on `PipelinePageInterface._raw` through the pipeline and injected into the
 * serialized output by the write tasks (`json:write`, `jsonl:append`) just before disk write.
 * Plugins must not read or write this field; it is managed entirely by built-in tasks.
 *
 * @category Pipeline
 * @since 2.5.0
 * @see {@link PipelinePageInterface}
 * @group Types
 */
export interface RawContentInterface {
  /** MIME content type of the fetched response (e.g. `"text/html"`, `"application/json"`). */
  readonly contentType: string;
  /** Raw response body string, byte-for-byte as received (HTML or JSON). */
  readonly content:     string;
  /** ISO-8601 timestamp at which the content was fetched. */
  readonly fetchedAt:   string;
}

/**
 * Normalized page data carried through the pipeline for both HTML and wiki sources.
 *
 * @remarks
 * Either `html` or `wikitext` (or both) will be present depending on the
 * scrape source.  Tasks should check for the field they need before accessing
 * it.
 *
 * @example
 * ```ts
 * const page: PipelinePageInterface = {
 *   targetId: 'pathfinder-monsters',
 *   title: 'Goblin',
 *   url: 'https://example.com/wiki/Goblin',
 *   wikitext: '{{Infobox|name=Goblin}}',
 * };
 * ```
 *
 * @category Pipeline
 * @since 2.0.0
 * @see {@link PipelineStateInterface}
 * @group Types
 */
export interface PipelinePageInterface {
  /** Scrape target identifier from the config. */
  readonly targetId:  string;
  /** Page title or URL used as a display/slug source. */
  readonly title:     string;
  /** Resolved URL of the page, if available. */
  readonly url:       string;
  /** Raw wikitext, present for MediaWiki-sourced pages. */
  readonly wikitext?: string | undefined;
  /** Raw HTML, present for HTML-sourced pages. */
  readonly html?:     string | undefined;
  /**
   * Raw fetched content; present only when `includeRawContent: true` is set on the target config.
   * Set by the fetch task; consumed by write tasks. Plugins must not touch this field.
   */
  readonly _raw?:     RawContentInterface | undefined;
}

/**
 * Shared mutable state passed through every task in a single pipeline run.
 *
 * @remarks
 * `output` starts as `null` and is expected to be populated by one of the
 * pipeline tasks.  Tasks may also attach arbitrary extra keys via the
 * `Record<string, unknown>` index signature for inter-task communication.
 *
 * @example
 * ```ts
 * const state: PipelineStateInterface = {
 *   targetId: 'pathfinder-monsters',
 *   page: { targetId: 'pathfinder-monsters', title: 'Goblin', url: '...' },
 *   output: null,
 * };
 * ```
 *
 * @category Pipeline
 * @since 2.0.0
 * @see {@link PipelinePageInterface}
 * @group Types
 */
export interface PipelineStateInterface extends Record<string, unknown> {
  /** Scrape target identifier from the config. */
  readonly targetId: string;
  /** Normalized page data for this pipeline execution. */
  readonly page:     PipelinePageInterface;
  /** Parsed output written by tasks; `null` until a task populates it. */
  output: Record<string, unknown> | null;
  /** Optional per-run context populated by the orchestrator for built-in tasks. */
  context?: PipelineContextInterface;
}
