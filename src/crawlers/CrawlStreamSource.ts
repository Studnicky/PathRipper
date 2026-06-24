/**
 * Pull-producer streaming crawl frontier.
 *
 * Returns an AsyncIterable<string> that yields one discovered target URL at a
 * time via BFS, lazily and back-pressured. The consumer (a ScatterNode with a
 * reservoir block) calls next() only as worker slots free; the generator runs
 * during the drain. Discovery overlaps page processing; the full frontier is
 * never materialized into an array.
 *
 * Mirrors the cartographer streaming pattern. The cyclic-DAG crawl:discover
 * remains the batch path; this is the pull-producer for the reservoir scatter.
 *
 * @module crawlers/CrawlStreamSource
 * @since 4.2.0
 */

import { CrawlFetcher }                    from '../nodes/crawl/CrawlFetcher.js';
import { extractLinks, classifyLinks }      from './CrawlLinks.js';
import type { RipperServices }             from '../services/RipperServices.js';

/**
 * Pull-producer streaming crawl frontier.
 *
 * Static methods only — no instances.
 *
 * @category Crawlers
 * @since 4.2.0
 */
export class CrawlStreamSource {
  private constructor() { /* static-only */ }

  /**
   * Returns a lazy AsyncIterable<string> that drives a BFS crawl and yields
   * one discovered target URL per next() call.
   *
   * If services.crawler, crawlLimiter, or crawlPolicy are absent, returns an
   * empty async iterator and logs a warning.
   */
  static stream(services: RipperServices): AsyncIterable<string> {
    const { log } = services;
    const crawler = services.crawler;
    const limiter = services.crawlLimiter;
    const policy  = services.crawlPolicy;

    if (crawler === undefined || limiter === undefined || policy === undefined) {
      log.warn('stream', 'crawler/crawlLimiter/crawlPolicy absent — returning empty stream');
      return {
        [Symbol.asyncIterator](): AsyncIterator<string> {
          return {
            next(): Promise<IteratorResult<string>> {
              return Promise.resolve({ value: undefined as unknown as string, done: true });
            },
          };
        },
      };
    }

    const { startUrls, domain, target, delimiter } = crawler;
    const maxPages   = crawler.maxPages;
    const headers    = services.headers ?? {};
    const cache      = services.cache;

    const domainRe    = new RegExp(domain);
    const delimiterRe = new RegExp(delimiter);
    const targetRe    = new RegExp(target);

    return {
      [Symbol.asyncIterator](): AsyncIterator<string> {
        let frontier:     string[]    = [...startUrls];
        let nextFrontier: string[]    = [];
        const visited:    Set<string> = new Set<string>();
        const discovered: Set<string> = new Set<string>();
        const buffer:     string[]    = [];
        let exhausted = false;

        return {
          async next(): Promise<IteratorResult<string>> {
            if (buffer.length > 0) {
              return { value: buffer.shift() as string, done: false };
            }
            if (exhausted) {
              return { value: undefined as unknown as string, done: true };
            }

            while (buffer.length === 0 && !exhausted) {
              if (maxPages !== undefined && discovered.size >= maxPages) {
                exhausted = true;
                break;
              }

              const candidates = frontier.filter(
                (url): boolean => !visited.has(url),
              );

              if (candidates.length === 0) {
                // Current level exhausted — promote next level
                const nextLevel = [...new Set(nextFrontier)].filter((url) => !visited.has(url));
                nextFrontier = [];
                frontier     = nextLevel;
                if (frontier.length === 0) {
                  exhausted = true;
                  break;
                }
                continue;
              }

              // Consume the current frontier level
              frontier = [];

              const settled = await Promise.allSettled(
                candidates.map((url): Promise<{ url: string; html: string }> =>
                  CrawlFetcher.fetch(url, headers, cache, limiter, policy)
                    .then((html): { url: string; html: string } => ({ url, html })),
                ),
              );

              for (const url of candidates) visited.add(url);

              for (const result of settled) {
                if (result.status === 'rejected') {
                  log.warn('stream', 'Fetch failed', { reason: String(result.reason) });
                  continue;
                }
                const { url, html } = result.value;
                const { targets, traversables } = classifyLinks(
                  extractLinks(html, url),
                  domainRe, delimiterRe, targetRe,
                );
                for (const link of targets) {
                  if (maxPages !== undefined && discovered.size >= maxPages) break;
                  if (!discovered.has(link)) {
                    discovered.add(link);
                    buffer.push(link);
                  }
                }
                for (const link of traversables) {
                  if (!visited.has(link)) nextFrontier.push(link);
                }
              }
            }

            if (buffer.length > 0) {
              return { value: buffer.shift() as string, done: false };
            }
            exhausted = true;
            return { value: undefined as unknown as string, done: true };
          },
        };
      },
    };
  }
}
