/**
 * CrawlFetcher — HTTP fetch primitive for the link-crawl embedded DAG.
 *
 * Wraps fetch with rate-limiting, retry policy, and optional cache.
 * All fetch logic is on this static class (not a freestanding function).
 *
 * @module nodes/crawl/CrawlFetcher
 * @since 4.1.0
 */

import { ScraperCache }        from '../../modules/cache/ScraperCache.js';
import type { RateLimiter }    from '../../modules/http/rateLimiter.js';
import type { HttpRetryPolicy } from '../../modules/http/httpRetryPolicy.js';

/**
 * HTTP fetch domain for crawl nodes.
 *
 * Static methods only — no instances.
 *
 * @category Nodes
 * @since 4.1.0
 */
export class CrawlFetcher {
  private constructor() {
    // Static-only class.
  }

  /**
   * Fetch the body of `url`, honouring the rate limiter, retry policy,
   * request headers, and cache.
   *
   * Cache key uses `GET + url + headers` for parity with `HtmlScraper`.
   * Throws on any non-2xx response or network error (after retries).
   *
   * @param url     - Absolute URL to fetch.
   * @param headers - Request headers to forward.
   * @param cache   - Optional response cache; `null` disables caching.
   * @param limiter - Rate limiter for the outbound request.
   * @param policy  - HTTP retry policy for transient failures.
   * @returns The response body as a UTF-8 string.
   */
  static async fetch(
    url:     string,
    headers: Record<string, string>,
    cache:   ReturnType<typeof ScraperCache.create> | null,
    limiter: RateLimiter,
    policy:  HttpRetryPolicy,
  ): Promise<string> {
    const networkFetch = (): Promise<string> =>
      limiter.schedule((): Promise<string> =>
        policy.run((): Promise<string> =>
          fetch(url, { headers }).then((response: Response): Promise<string> => {
            if (!response.ok) {
              const fetchError = Object.assign(
                new Error(`HTTP ${response.status.toString()} for ${url}`),
                { status: response.status },
              );
              return Promise.reject(fetchError);
            }
            return response.text();
          }),
        ),
      );

    if (cache === null) return networkFetch();

    const key = ScraperCache.keyFor({ method: 'GET', url, headers });
    const hit = await cache.read(key);
    if (hit !== null) return hit.body;

    const body = await networkFetch();
    await cache.write(key, body, {
      url, method: 'GET', fetchedAt: new Date().toISOString(), status: 200,
    });
    return body;
  }

  /**
   * Extract the HTTP status code from an unknown thrown value.
   *
   * @param err - The thrown value to inspect.
   * @returns The numeric status code, or `null` when absent.
   */
  static extractStatus(err: unknown): number | null {
    if (err !== null && typeof err === 'object' && 'status' in err) {
      const status = (err as { status: unknown }).status;
      return typeof status === 'number' ? status : null;
    }
    return null;
  }
}
