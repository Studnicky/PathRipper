/**
 * RipperServices — plain services bag for one scrape run.
 *
 * A plain interface; no class, no static factories, no DI container.
 * Construct an object literal satisfying this shape and pass it to the
 * `RipperDagonizer` constructor as `{ services }`.
 *
 * Every node receives this bag via `context.services`.
 *
 * @module services/RipperServices
 * @since 3.0.0
 */

import type { DagonizerInterface } from '@studnicky/dagonizer';

import type { HtmlScraper }       from '../scrapers/HtmlScraper.js';
import type { MediaWikiScraper }  from '../scrapers/MediaWikiScraper.js';
import type { Logger }            from '../modules/logger/logger.js';
import type { ScraperCache }      from '../modules/cache/ScraperCache.js';
import type { RateLimiter }       from '../modules/http/rateLimiter.js';
import type { HttpRetryPolicy }   from '../modules/http/httpRetryPolicy.js';
import type { ScrapeState }       from '../state/ScrapeState.js';
import type { RunCrawlerType }    from '../types/RunState.js';
import type { FailurePolicyInterface } from '../resilience/FailurePolicy.js';
import type { ReconcilerInterface }    from '../resilience/Reconciler.js';

/**
 * Shared services injected into every node via `context.services`.
 *
 * Construct an inline object literal satisfying this interface and pass it to
 * `new RipperDagonizer<ScrapeState>({ services })`. The same bag flows through
 * every node in every execution for the lifetime of the dispatcher instance.
 *
 * @category Services
 * @since 3.0.0
 */
export type RipperServices = {
  /** Logger instance for scrape-layer diagnostics. */
  readonly log:            Logger;
  /** Shared page cache; `null` when caching is disabled for this target. */
  readonly cache:          ScraperCache | null;
  /** HTML scraper; present for HTML runs, absent for wiki runs. */
  readonly htmlScraper?:   HtmlScraper | undefined;
  /** MediaWiki scraper; present for wiki runs, absent for HTML runs. */
  readonly wikiScraper?:   MediaWikiScraper | undefined;
  /** Target identifier for this run (the orchestration DAG name). */
  readonly target:         { id: string };
  /** Output base directory. */
  readonly outDir:         string;
  /**
   * Typed crawler block. Present when a crawler is configured for this run.
   */
  readonly crawler?:       RunCrawlerType | undefined;
  /**
   * Rate limiter for crawl HTTP requests. Built in `runDag` from
   * `crawler.rateLimitMs` / `crawler.jitterMs` when the crawler block is
   * present. Absent when no crawler is configured.
   */
  readonly crawlLimiter?:  RateLimiter | undefined;
  /**
   * HTTP retry policy for crawl requests. Built in `runDag` from run-state
   * retry params when the crawler block is present. Absent when no crawler
   * is configured.
   */
  readonly crawlPolicy?:   HttpRetryPolicy | undefined;
  /**
   * Additional HTTP request headers for this run.
   */
  readonly headers?:       Record<string, string> | undefined;
  /**
   * When `false`, raw HTTP response bodies are NOT stored alongside output.
   * Defaults to `true` when absent.
   */
  readonly includeRawContent?: boolean | undefined;
  /**
   * Filesystem path to a JSON Schema file for validating pipeline output records.
   * Absent when no schema validation is configured.
   */
  readonly outputSchema?:  string | undefined;
  /**
   * Governs behaviour when a pipeline output record fails `outputSchema` validation.
   * `halt` aborts the run; `skip` drops the record; `warn` logs and continues.
   * Absent when `outputSchema` is not set.
   */
  readonly onSchemaError?: 'halt' | 'skip' | 'warn' | undefined;
  /** Name of the first non-built-in pipeline step (plugin), if any. */
  readonly pluginTaskName?:  string | undefined;
  /**
   * When `false`, plugin output lands in a single JSONL; when `true` (or
   * absent), it is split per record into a per-plugin subfolder.
   */
  readonly splitByTaskName?: boolean | undefined;
  /**
   * Failure policy for classifying and routing node failures.
   * When absent, `DefaultFailurePolicy` (retryable→retry up to 2x, else→capture) is used.
   */
  readonly failurePolicy?: FailurePolicyInterface | undefined;
  /**
   * Identity reconciler for the post-crawl `reconcile:identity` phase.
   * When absent, `DefaultReconciler` (all failures → `missing`) is used.
   */
  readonly reconciler?: ReconcilerInterface | undefined;
  /**
   * Dispatcher reference for nodes that need to run child DAGs. Set to the
   * same dispatcher this services bag is registered on so nodes can call
   * `services.dispatcher.execute(...)`.
   */
  readonly dispatcher: DagonizerInterface<ScrapeState, RipperServices>;
};
