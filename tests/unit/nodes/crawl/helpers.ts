/**
 * Shared test helpers for crawl node unit tests.
 */
import { NodeContextBuilder } from '@studnicky/dagonizer/entities';
import type { NodeContextType } from '@studnicky/dagonizer';

import { ScrapeState }         from '../../../../src/state/ScrapeState.js';
import type { RipperServices } from '../../../../src/services/RipperServices.js';
import { RateLimiter }         from '../../../../src/modules/http/rateLimiter.js';
import { HttpRetryPolicy }     from '../../../../src/modules/http/httpRetryPolicy.js';

/** Minimal context stub — real services are not needed for unit tests without HTTP. */
export const makeTestContext = (
  crawlCfg?: {
    domain?:      string;
    target?:      string;
    delimiter?:   string;
    startUrls?:   string[];
    maxPages?:    number;
  },
  limiter?: RipperServices['crawlLimiter'],
  policy?:  RipperServices['crawlPolicy'],
): NodeContextType<RipperServices> => {
  const crawlerBlock = crawlCfg !== undefined
    ? {
        startUrls: crawlCfg.startUrls ?? [],
        domain:    crawlCfg.domain    ?? 'example\\.com',
        target:    crawlCfg.target    ?? '\\?id=',
        delimiter: crawlCfg.delimiter ?? 'category',
        ...(crawlCfg.maxPages !== undefined ? { maxPages: crawlCfg.maxPages } : {}),
      }
    : undefined;

  return NodeContextBuilder.of<RipperServices>(
    'test',
    'test',
    new AbortController().signal,
    {
      log: {
        debug: () => {},
        info:  () => {},
        warn:  () => {},
        error: () => {},
      } as unknown as RipperServices['log'],
      cache:         null,
      target:        { id: 'test' },
      outDir:        '/tmp/test',
      dispatcher:    {} as RipperServices['dispatcher'],
      ...(crawlerBlock !== undefined ? { crawler: crawlerBlock } : {}),
      ...(limiter !== undefined ? { crawlLimiter: limiter } : {}),
      ...(policy  !== undefined ? { crawlPolicy:  policy  } : {}),
    } as unknown as RipperServices,
  );
};

/**
 * Build a minimal ScrapeState with crawl sub-state fields pre-set.
 *
 * All crawl fields land under `state.crawl.*` (not on the state directly).
 * Tests that access `state.discoveredRaw`, `state.frontier`, etc. must
 * use `state.crawl.discoveredRaw`, `state.crawl.frontier`, etc.
 */
export const makeState = (opts: {
  domainRe?:    string;
  targetRe?:    string;
  delimiterRe?: string;
  frontier?:    string[];
  visited?:     string[];
  discovered?:  string[];
  maxDepth?:    number;
  depth?:       number;
} = {}): ScrapeState => {
  const state = new ScrapeState();
  state.crawl = {
    ...state.crawl,
    domainRe:    opts.domainRe    ?? 'example\\.com',
    targetRe:    opts.targetRe    ?? '\\?id=',
    delimiterRe: opts.delimiterRe ?? 'category',
    frontier:    opts.frontier    ?? [],
    visited:     opts.visited     ?? [],
    discovered:  opts.discovered  ?? [],
    maxDepth:    opts.maxDepth,
    depth:       opts.depth       ?? 0,
  };
  return state;
};

/** Build a context with limiter + policy for tests that make HTTP calls. */
export const makeHttpContext = (
  crawlCfg?: Parameters<typeof makeTestContext>[0],
  maxPages?: number,
): NodeContextType<RipperServices> => {
  const limiter = RateLimiter.create({ minTimeMs: 0 });
  const policy  = HttpRetryPolicy.create({ maxAttempts: 1 });
  const baseCfg = crawlCfg ?? {};
  return makeTestContext(
    { ...baseCfg, ...(maxPages !== undefined ? { maxPages } : {}) },
    limiter,
    policy,
  );
};
