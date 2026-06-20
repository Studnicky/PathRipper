/**
 * Shared test helpers for crawl node unit tests.
 */
import type { NodeContextType } from '@studnicky/dagonizer';
import { LinkCrawlState }         from '../../../../src/state/LinkCrawlState.js';
import type { LinkCrawlServices } from '../../../../src/nodes/crawl/Services.js';

/** Minimal context stub — real services are not needed for unit tests. */
export const makeTestContext = (
  services: Partial<LinkCrawlServices> = {},
): NodeContextType<LinkCrawlServices> => ({
  dagName:  'test',
  nodeName: 'test',
  signal:   new AbortController().signal,
  services: {
    log: {
      debug: () => {},
      info:  () => {},
      warn:  () => {},
      error: () => {},
    } as unknown as LinkCrawlServices['log'],
    cache:      null,
    limiter:    {} as LinkCrawlServices['limiter'],
    policy:     {} as LinkCrawlServices['policy'],
    dispatcher: {} as LinkCrawlServices['dispatcher'],
    ...services,
  },
});

/** Build a minimal LinkCrawlState with regex fields pre-set. */
export const makeState = (opts: {
  domainRe?:    string;
  targetRe?:    string;
  delimiterRe?: string;
  frontier?:    string[];
  visited?:     string[];
  discovered?:  string[];
  maxPages?:    number;
  maxDepth?:    number;
  depth?:       number;
} = {}): LinkCrawlState => {
  const state = new LinkCrawlState();
  state.domainRe    = opts.domainRe    ?? 'example\\.com';
  state.targetRe    = opts.targetRe    ?? '\\?id=';
  state.delimiterRe = opts.delimiterRe ?? 'category';
  state.frontier    = opts.frontier    ?? [];
  state.visited     = opts.visited     ?? [];
  state.discovered  = opts.discovered  ?? [];
  state.maxPages    = opts.maxPages;
  state.maxDepth    = opts.maxDepth;
  state.depth       = opts.depth       ?? 0;
  return state;
};
