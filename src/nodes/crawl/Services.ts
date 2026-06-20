import type { DagonizerInterface } from '@studnicky/dagonizer';

import type { Logger }       from '../../modules/logger/logger.js';
import type { ScraperCache } from '../../modules/cache/ScraperCache.js';
import type { RateLimiter }  from '../../modules/http/rateLimiter.js';
import type { HttpRetryPolicy } from '../../modules/http/httpRetryPolicy.js';
import type { LinkCrawlState } from '../../state/LinkCrawlState.js';

/**
 * Services injected into every node in the link-crawl DAG.
 *
 * @remarks
 * The `dispatcher` field allows the DAG executor to be referenced
 * from within nodes for any future sub-dispatch needs. The `limiter`
 * and `policy` are the shared HTTP primitives so fetch behaviour is
 * consistent with the existing `LinkLister` implementation.
 *
 * @category Services
 * @since 3.0.0
 */
export type LinkCrawlServices = {
  /** Logger for node-level diagnostics. */
  readonly log: Logger;
  /** Optional shared HTTP response cache; `null` when caching is disabled. */
  readonly cache: ScraperCache | null;
  /** Rate limiter for outbound HTTP requests. */
  readonly limiter: RateLimiter;
  /** HTTP retry policy for transient failures. */
  readonly policy: HttpRetryPolicy;
  /** The Dagonizer dispatcher for this crawl run. */
  readonly dispatcher: DagonizerInterface<LinkCrawlState, LinkCrawlServices>;
};
