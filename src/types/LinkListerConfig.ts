import type { HttpRetryConfigInterface } from '../modules/http/httpRetryPolicy.js';
import type { ScraperCache } from '../modules/cache/ScraperCache.js';

/**
 * Configuration that controls `LinkLister` crawl and collection behavior.
 *
 * @remarks
 * `domain` is tested against every discovered href to decide whether to follow
 * it.  `target` is tested against each followed URL to decide whether to
 * collect it as a result.  `delimiter` partitions URLs for traversal decisions.
 * Together they let callers restrict crawls to a specific site section and
 * collect only the pages that match a finer pattern.
 *
 * @example
 * ```ts
 * const config: LinkListerConfigInterface = {
 *   domain: /^https:\/\/example\.com/,
 *   target: /\/items\/[^/]+$/,
 *   delimiter: /\/items\//,
 *   rateLimitMs: 500,
 *   maxPages: 100,
 *   cache: ScraperCache.create({ dir: './.cache', mode: 'read-write' }),
 * };
 * ```
 *
 * @category Crawlers
 * @since 2.0.0
 * @see {@link HttpRetryConfigInterface}
 * @group Types
 */
export interface LinkListerConfigInterface {
  /** Pattern that every link must match to be followed. */
  readonly domain: RegExp;
  /** Pattern that a link must match to be collected as a result. */
  readonly target: RegExp;
  /** Pattern used to partition links for traversal decisions. */
  readonly delimiter: RegExp;
  /** Minimum milliseconds between requests. */
  readonly rateLimitMs?: number | undefined;
  /** Maximum random jitter added to each delay, in milliseconds. */
  readonly jitterMs?:    number | undefined;
  /** Maximum number of target links to collect before stopping. */
  readonly maxPages?:    number | undefined;
  /** Retry configuration for failed requests. */
  readonly retry?: HttpRetryConfigInterface | undefined;
  /** HTTP headers sent with every request; passed identically to scrapers for cache-key parity. */
  readonly headers?: Readonly<Record<string, string>> | undefined;
  /** Shared content store; bodies fetched here become free hits for the scraper later in the same target run. */
  readonly cache: ScraperCache;
}
