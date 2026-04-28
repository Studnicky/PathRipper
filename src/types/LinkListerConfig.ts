import type { RetryConfigInterface } from './RetryExecutor.js';

/** Configuration for LinkLister crawl behavior. */
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
  readonly retry?: RetryConfigInterface | undefined;
}
