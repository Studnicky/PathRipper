import { load } from 'cheerio';
import type { Element } from 'domhandler';

import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';

import { ScraperCache }           from '../../modules/cache/ScraperCache.js';
import type { RateLimiter }        from '../../modules/http/rateLimiter.js';
import type { HttpRetryPolicy }    from '../../modules/http/httpRetryPolicy.js';
import type { LinkCrawlState }     from '../../state/LinkCrawlState.js';
import type { LinkCrawlServices }  from './Services.js';

/**
 * Fetches every URL in `state.frontier` and extracts outbound links.
 *
 * @remarks
 * Processes all frontier URLs as a batch within a single node execution
 * (not a DAG fan-out), so discovered links can be written directly into
 * `state.nextFrontierRaw` and `state.discoveredRaw` without workarounds
 * for fan-out item isolation.
 *
 * Link classification uses the three regex sources on state:
 * - `domainRe`    — must match; offsite links are dropped.
 * - `delimiterRe` — must match; both traversable and target links match this.
 * - `targetRe`    — further subset: links that also match this go to
 *                   `discoveredRaw`. Links that match `delimiterRe` but NOT
 *                   `targetRe` go to `nextFrontierRaw` for the next level.
 *
 * Output ports:
 * - `success`   — at least one link (target or traversable) was found.
 * - `empty`     — all pages fetched but no new links discovered.
 * - `error`     — at least one transient fetch failure occurred.
 * - `permanent` — all failures were 4xx (permanent); no retry expected.
 *
 * @category Nodes
 * @since 3.0.0
 */
class FetchAndExtractLinksNodeImpl extends ScalarNode<
  LinkCrawlState,
  'success' | 'empty' | 'error' | 'permanent',
  LinkCrawlServices
> {
  public readonly name = 'crawl:fetch-and-extract';
  public readonly outputs = ['success', 'empty', 'error', 'permanent'] as const;

  protected override async executeOne(
    state: LinkCrawlState,
    context: NodeContextType<LinkCrawlServices>,
  ): Promise<NodeOutputType<'success' | 'empty' | 'error' | 'permanent'>> {
    const { services } = context;
    const { log, limiter, policy, cache } = services;

    if (state.frontier.length === 0) {
      return NodeOutputBuilder.of('empty');
    }

    const domainRe    = new RegExp(state.domainRe);
    const delimiterRe = new RegExp(state.delimiterRe);
    const targetRe    = new RegExp(state.targetRe);

    const visitedSet    = new Set<string>(state.visited);
    const discoveredSet = new Set<string>(state.discovered);

    let transientErrors  = 0;
    let permanentErrors  = 0;
    let anyLinksFound    = false;

    for (const url of state.frontier) {
      // Budget check
      const budget = state.maxPages;
      if (budget !== undefined && discoveredSet.size >= budget) break;

      // Skip already-visited URLs (handles duplicate seeds and intra-level duplicates)
      if (visitedSet.has(url)) continue;

      let html: string;
      try {
        html = await fetchBody(url, state.headers, cache, limiter, policy);
      } catch (err) {
        const status = extractStatus(err);
        log.warn('FetchAndExtractLinksNode', `Fetch failed for ${url}`, { status });
        if (status !== null && status >= 400 && status < 500) {
          permanentErrors++;
        } else {
          transientErrors++;
        }
        continue;
      }

      visitedSet.add(url);

      const allLinks = extractLinks(html, url)
        .filter((link) => domainRe.test(link))
        .filter((link) => delimiterRe.test(link));

      for (const link of allLinks) {
        if (budget !== undefined && discoveredSet.size >= budget) break;

        if (targetRe.test(link)) {
          if (!discoveredSet.has(link)) {
            discoveredSet.add(link);
            state.discoveredRaw.push(link);
            anyLinksFound = true;
          }
        } else if (!visitedSet.has(link)) {
          state.nextFrontierRaw.push(link);
          anyLinksFound = true;
        }
      }
    }

    // Update visited from the set (deduplicated)
    state.visited = Array.from(visitedSet);

    log.debug(
      'FetchAndExtractLinksNode',
      `Level ${state.depth.toString()}: discovered ${state.discoveredRaw.length.toString()} targets, `
        + `${state.nextFrontierRaw.length.toString()} traversable links`,
    );

    if (transientErrors > 0) return NodeOutputBuilder.of('error');
    if (permanentErrors > 0 && !anyLinksFound) return NodeOutputBuilder.of('permanent');
    if (!anyLinksFound) return NodeOutputBuilder.of('empty');
    return NodeOutputBuilder.of('success');
  }
}

export const FetchAndExtractLinksNode = new FetchAndExtractLinksNodeImpl();

// ── Private helpers ────────────────────────────────────────────────────────────

const extractStatus = (err: unknown): number | null => {
  if (err !== null && typeof err === 'object' && 'status' in err) {
    const status = (err as { status: unknown }).status;
    return typeof status === 'number' ? status : null;
  }
  return null;
};

const fetchBody = async (
  url:     string,
  headers: Record<string, string>,
  cache:   ReturnType<typeof ScraperCache.create> | null,
  limiter: RateLimiter,
  policy:  HttpRetryPolicy,
): Promise<string> => {
  const networkFetch = (): Promise<string> =>
    limiter.schedule((): Promise<string> =>
      policy.run((): Promise<string> =>
        fetch(url, { headers }).then((response: Response): Promise<string> => {
          if (!response.ok) {
            const fetchError = Object.assign(new Error(`HTTP ${response.status.toString()} for ${url}`), { status: response.status });
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
};

const extractLinks = (html: string, baseUrl: string): string[] => {
  const root = load(html);
  const links: string[] = [];
  root('a[href]').each((_index: number, element: Element): void => {
    const href = root(element).attr('href');
    if (href === undefined) return;
    try {
      links.push(new URL(href, baseUrl).href);
    } catch {
      // relative or invalid — skip
    }
  });
  return links;
};
