import { load } from 'cheerio';
import type { Element } from 'domhandler';

import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContract } from '@noocodex/dagonizer/contracts';

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
export const FetchAndExtractLinksNode: NodeInterface<
  LinkCrawlState,
  'success' | 'empty' | 'error' | 'permanent',
  LinkCrawlServices
> = {
  name: 'crawl:fetch-and-extract',
  outputs: ['success', 'empty', 'error', 'permanent'],

  async execute(
    state: LinkCrawlState,
    context: NodeContextInterface<LinkCrawlServices>,
  ): Promise<{ output: 'success' | 'empty' | 'error' | 'permanent' }> {
    const { services } = context;
    const { log, limiter, policy, cache } = services;

    if (state.frontier.length === 0) {
      return { output: 'empty' };
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
        .filter((l) => domainRe.test(l))
        .filter((l) => delimiterRe.test(l));

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

    if (transientErrors > 0) return { output: 'error' };
    if (permanentErrors > 0 && !anyLinksFound) return { output: 'permanent' };
    if (!anyLinksFound) return { output: 'empty' };
    return { output: 'success' };
  },
};

/** OperationContract for FetchAndExtractLinksNode: reads frontier, produces discoveredRaw. */
export const fetchAndExtractLinksContract: OperationContract = {
  name:         'crawl:fetch-and-extract',
  hardRequired: ['frontier'],
  produces:     ['discoveredRaw'],
  outputs:      ['success', 'empty', 'error', 'permanent'],
};

// ── Private helpers ────────────────────────────────────────────────────────────

const extractStatus = (err: unknown): number | null => {
  if (err !== null && typeof err === 'object' && 'status' in err) {
    const s = (err as { status: unknown }).status;
    return typeof s === 'number' ? s : null;
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
        fetch(url, { headers }).then((r: Response): Promise<string> => {
          if (!r.ok) {
            const e = Object.assign(new Error(`HTTP ${r.status.toString()} for ${url}`), { status: r.status });
            return Promise.reject(e);
          }
          return r.text();
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
  const $ = load(html);
  const links: string[] = [];
  $('a[href]').each((_i: number, el: Element): void => {
    const href = $(el).attr('href');
    if (href === undefined) return;
    try {
      links.push(new URL(href, baseUrl).href);
    } catch {
      // relative or invalid — skip
    }
  });
  return links;
};
