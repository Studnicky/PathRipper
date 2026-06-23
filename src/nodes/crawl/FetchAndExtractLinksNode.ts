import { load } from 'cheerio';
import type { Element } from 'domhandler';

import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';

import { CrawlFetcher }        from './CrawlFetcher.js';
import type { ScrapeState }    from '../../state/ScrapeState.js';
import type { RipperServices } from '../../services/RipperServices.js';

const HTTP_CLIENT_ERROR_MIN = 400;
const HTTP_SERVER_ERROR_MIN = 500;

/**
 * Fetches every URL in `state.crawl.frontier` and extracts outbound links.
 *
 * @remarks
 * Processes all frontier URLs as a batch within a single node execution.
 * Discovered links are written into `state.crawl.nextFrontierRaw` and
 * `state.crawl.discoveredRaw`. Uses `services.crawlLimiter` and
 * `services.crawlPolicy` for rate-limiting and retry.
 *
 * Link classification uses three regex sources on `state.crawl`:
 * - `domainRe`    — must match; offsite links are dropped.
 * - `delimiterRe` — must match; both traversable and target links match this.
 * - `targetRe`    — further subset: links matching this go to `discoveredRaw`.
 *                   Links matching `delimiterRe` but NOT `targetRe` go to
 *                   `nextFrontierRaw` for the next level.
 *
 * Requires `services.crawlLimiter` and `services.crawlPolicy` to be present.
 * These are built in `runDag` when `state.crawler` is configured.
 *
 * Output ports:
 * - `success`   — at least one link (target or traversable) was found.
 * - `empty`     — all pages fetched but no new links discovered.
 * - `error`     — at least one transient fetch failure occurred.
 * - `permanent` — all failures were 4xx (permanent); no retry expected.
 *
 * @category Nodes
 * @since 4.1.0
 */
class FetchAndExtractLinksNodeImpl extends ScalarNode<
  ScrapeState,
  'success' | 'empty' | 'error' | 'permanent',
  RipperServices
> {
  public readonly name = 'crawl:fetch-and-extract';
  public readonly outputs = ['success', 'empty', 'error', 'permanent'] as const;

  public override get outputSchema(): Record<'success' | 'empty' | 'error' | 'permanent', SchemaObjectType> {
    return {
      // `success` — links found; `state.crawl.visited`, `discoveredRaw`, and `nextFrontierRaw` updated.
      success: {
        type: 'object',
        properties: {
          crawl: {
            type: 'object',
            properties: {
              visited:         { type: 'array', items: { type: 'string' } },
              discoveredRaw:   { type: 'array', items: { type: 'string' } },
              nextFrontierRaw: { type: 'array', items: { type: 'string' } },
            },
            required: ['visited', 'discoveredRaw', 'nextFrontierRaw'],
          },
        },
        required: ['crawl'],
      },
      // `empty` — frontier empty or all pages fetched with no new links; `state.crawl.visited` updated.
      empty: {
        type: 'object',
        properties: {
          crawl: {
            type: 'object',
            properties: {
              visited: { type: 'array', items: { type: 'string' } },
            },
            required: ['visited'],
          },
        },
        required: ['crawl'],
      },
      // `error` — transient fetch failures occurred; `state.crawl.visited` may be partially updated.
      error: { type: 'object' },
      // `permanent` — all failures were 4xx permanent; no links found; no retry expected.
      permanent: { type: 'object' },
    };
  }

  protected override async executeOne(
    state:   ScrapeState,
    context: NodeContextType<RipperServices>,
  ): Promise<NodeOutputType<'success' | 'empty' | 'error' | 'permanent'>> {
    const { services } = context;
    const { log, cache } = services;
    const headers = services.headers ?? {};

    if (state.crawl.frontier.length === 0) {
      return NodeOutputBuilder.of('empty');
    }

    if (services.crawlLimiter === undefined || services.crawlPolicy === undefined) {
      log.warn('FetchAndExtractLinksNode', 'crawlLimiter/crawlPolicy absent — crawler not configured');
      return NodeOutputBuilder.of('error');
    }

    const { crawlLimiter: limiter, crawlPolicy: policy } = services;

    const domainRe    = new RegExp(state.crawl.domainRe);
    const delimiterRe = new RegExp(state.crawl.delimiterRe);
    const targetRe    = new RegExp(state.crawl.targetRe);

    const visitedSet    = new Set<string>(state.crawl.visited);
    const discoveredSet = new Set<string>(state.crawl.discovered);
    const maxPages      = services.crawler?.maxPages;

    // Pre-filter: drop already-visited URLs and early-exit on budget
    const candidateUrls = state.crawl.frontier.filter((url: string): boolean => {
      if (visitedSet.has(url)) return false;
      if (maxPages !== undefined && discoveredSet.size >= maxPages) return false;
      return true;
    });

    // Fetch all candidate URLs concurrently; maxConcurrent is enforced by the
    // rate limiter (Bottleneck) that was built with crawler.concurrency in runDag.
    const settled = await Promise.allSettled<{ url: string; html: string }>(
      candidateUrls.map((url: string): Promise<{ url: string; html: string }> =>
        CrawlFetcher.fetch(url, headers, cache, limiter, policy).then((html: string): { url: string; html: string } => ({ url, html })),
      ),
    );

    let transientErrors = 0;
    let permanentErrors = 0;
    let anyLinksFound   = false;

    for (const result of settled) {
      if (result.status === 'rejected') {
        const status = CrawlFetcher.extractStatus(result.reason);
        log.warn('FetchAndExtractLinksNode', 'Fetch failed', { status });
        if (status !== null && status >= HTTP_CLIENT_ERROR_MIN && status < HTTP_SERVER_ERROR_MIN) {
          permanentErrors++;
        } else {
          transientErrors++;
        }
        continue;
      }

      const { url, html } = result.value;
      visitedSet.add(url);

      const allLinks = extractLinks(html, url)
        .filter((link: string): boolean => domainRe.test(link))
        .filter((link: string): boolean => delimiterRe.test(link));

      for (const link of allLinks) {
        if (maxPages !== undefined && discoveredSet.size >= maxPages) break;

        if (targetRe.test(link)) {
          if (!discoveredSet.has(link)) {
            discoveredSet.add(link);
            state.crawl.discoveredRaw.push(link);
            anyLinksFound = true;
          }
        } else if (!visitedSet.has(link)) {
          state.crawl.nextFrontierRaw.push(link);
          anyLinksFound = true;
        }
      }
    }

    // Update visited from the set (deduplicated)
    state.crawl.visited = Array.from(visitedSet);

    log.debug(
      'FetchAndExtractLinksNode',
      `Level ${state.crawl.depth.toString()}: discovered ${state.crawl.discoveredRaw.length.toString()} targets, `
        + `${state.crawl.nextFrontierRaw.length.toString()} traversable links`,
    );

    if (transientErrors > 0) return NodeOutputBuilder.of('error');
    if (permanentErrors > 0 && !anyLinksFound) return NodeOutputBuilder.of('permanent');
    if (!anyLinksFound) return NodeOutputBuilder.of('empty');
    return NodeOutputBuilder.of('success');
  }
}

/**
 * Built-in node — fetches all URLs in `state.crawl.frontier` and extracts outbound links.
 *
 * @remarks
 * Registered as `crawl:fetch-and-extract`. Processes the frontier batch with `Promise.allSettled`,
 * honouring `services.crawlLimiter` for concurrency and rate-limiting.
 *
 * @example
 * ```json
 * { "@type": "SingleNode", "name": "crawl:fetch-and-extract", "node": "crawl:fetch-and-extract" }
 * ```
 *
 * @see {@link CrawlFetcher}
 * @category Nodes
 * @since 4.1.0
 * @group Crawl
 * @defaultValue Singleton instance created at module load time.
 */
export const FetchAndExtractLinksNode = new FetchAndExtractLinksNodeImpl();

// ── Private helpers ────────────────────────────────────────────────────────────

const extractLinks = (html: string, baseUrl: string): string[] => {
  const root = load(html);
  const links: string[] = [];
  root('a[href]').each((_index: number, element: Element): void => {
    const href = root(element).attr('href');
    if (href === undefined || href.startsWith('#')) return;
    try {
      links.push(new URL(href, baseUrl).href);
    } catch {
      // relative or invalid — skip
    }
  });
  return links;
};
