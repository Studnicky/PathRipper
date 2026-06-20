import { Dagonizer }    from '@studnicky/dagonizer';

import type { BuildListResult }         from '../types/Results.js';
import { Logger }                       from '../modules/logger/logger.js';
import { RateLimiter }                  from '../modules/http/rateLimiter.js';
import { HttpRetryPolicy }              from '../modules/http/httpRetryPolicy.js';
import type { LinkListerConfigType } from '../types/LinkListerConfig.js';

import { LinkCrawlState }           from '../state/LinkCrawlState.js';
import { InitFrontierNode }         from '../nodes/crawl/InitFrontierNode.js';
import { FetchAndExtractLinksNode } from '../nodes/crawl/FetchAndExtractLinksNode.js';
import { DedupeAndEnqueueNode }     from '../nodes/crawl/DedupeAndEnqueueNode.js';
import { CrawlExhaustedNode }       from '../nodes/crawl/CrawlExhaustedNode.js';
import type { LinkCrawlServices }   from '../nodes/crawl/Services.js';
import { buildLinkCrawlFlow, LINK_CRAWL_FLOW_NAME } from '../flows/linkCrawlFlow.js';

export type { LinkListerConfigType };

const DEFAULT_RATE_LIMIT_MS = 100;

/**
 * Crawls a site from seed URLs and returns all matching target links, deduplicated and sorted.
 *
 * @remarks
 * Backed by a Dagonizer DAG (`linkCrawlDAG`). The crawl proceeds level-by-level:
 * `init-frontier → [fetch-N → dedupe-N]* → exhausted`. Each level is a
 * `FetchAndExtractLinksNode` that processes all frontier URLs and writes
 * discovered links into accumulator fields, followed by `DedupeAndEnqueueNode`
 * which promotes unique URLs to the next level's frontier. The DAG terminates
 * when the frontier empties, the `maxDepth` limit is reached, or `maxPages`
 * targets are collected.
 *
 * The public `LinkLister.create(cfg)` factory and `buildList(urls)` signatures
 * are unchanged from prior versions so existing callers require no modification.
 *
 * @example
 * ```ts
 * const cache = ScraperCache.create({ dir: './.cache', mode: 'read-write' });
 * const lister = LinkLister.create({ domain: /example\.com/, target: /\/item\//, delimiter: /\//, cache });
 * const links = await lister.buildList(['https://example.com/items/']);
 * ```
 *
 * @category Crawlers
 * @since 3.0.0
 * @see {@link LinkListerConfigType}
 * @group Core
 */
export class LinkLister {
  readonly #config: LinkListerConfigType;
  readonly #log: Logger;

  /**
   * @param config - Crawl configuration including domain, target, rate-limit settings, and a shared cache.
   */
  private constructor(config: LinkListerConfigType) {
    this.#config = config;
    this.#log    = Logger.forComponent('LinkLister');
  }

  /**
   * Creates a LinkLister instance.
   *
   * @param config - Crawl configuration.
   * @returns A new LinkLister.
   */
  public static create(config: LinkListerConfigType): LinkLister {
    return new LinkLister(config);
  }

  /**
   * Crawls from the given seed URLs and returns all collected target links.
   *
   * @param startUrls - Seed URLs to begin crawling from.
   * @returns Deduplicated, numerically sorted array of matching target URLs.
   */
  async buildList(startUrls: ReadonlyArray<string>): BuildListResult {
    if (startUrls.length === 0) {
      this.#log.warn('buildList', 'Called with empty startUrls list');
      return [];
    }
    this.#log.debug('buildList', `Starting crawl from ${startUrls.length.toString()} seed(s)`);

    const cfg = this.#config;

    // ── Build services ──────────────────────────────────────────────────────────
    const limiter = RateLimiter.create({
      minTimeMs: cfg.rateLimitMs ?? DEFAULT_RATE_LIMIT_MS,
      jitterMs:  cfg.jitterMs ?? 0,
    });
    const policy = HttpRetryPolicy.create(cfg.retry);

    // The services holder/proxy pattern breaks the construction circularity:
    // dispatcher needs services, but services.dispatcher needs the dispatcher reference.
    const holder: { current: LinkCrawlServices | null } = { current: null };
    const dispatcher = new Dagonizer<LinkCrawlState, LinkCrawlServices>({
      services: new Proxy({} as LinkCrawlServices, {
        get(_target, prop) {
          if (holder.current === null) {
            throw new Error('LinkCrawlServices accessed before initialisation');
          }
          return (holder.current as unknown as Record<string | symbol, unknown>)[prop as string];
        },
      }),
    });

    const services: LinkCrawlServices = {
      log:        this.#log,
      cache:      cfg.cache ?? null,
      limiter,
      policy,
      dispatcher,
    };
    holder.current = services;

    // ── Register nodes ──────────────────────────────────────────────────────────
    dispatcher.registerNode(InitFrontierNode);
    dispatcher.registerNode(FetchAndExtractLinksNode);
    dispatcher.registerNode(DedupeAndEnqueueNode);
    dispatcher.registerNode(CrawlExhaustedNode);

    // ── Register DAGs ───────────────────────────────────────────────────────────
    dispatcher.registerDAG(buildLinkCrawlFlow());

    // ── Build initial state ─────────────────────────────────────────────────────
    const state = new LinkCrawlState();
    state.seedUrls    = Array.from(startUrls);
    state.domainRe    = cfg.domain.source;
    state.targetRe    = cfg.target.source;
    state.delimiterRe = cfg.delimiter.source;
    state.maxPages    = cfg.maxPages;
    state.headers     = { ...(cfg.headers ?? {}) };
    // maxDepth is not exposed in LinkListerConfigType; leave as undefined
    // so the DAG runs until frontier-empty or budget-exhausted.

    // ── Dispatch ────────────────────────────────────────────────────────────────
    await dispatcher.execute(LINK_CRAWL_FLOW_NAME, state);

    const result = state.discovered;
    this.#log.info('buildList', `Found ${result.length.toString()} matching links`);
    return result;
  }
}
