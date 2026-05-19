/**
 * Shared test helpers for crawl node unit tests.
 */
import type { NodeContextInterface } from '@noocodex/dagonizer';
import { LinkCrawlState }         from '../../../../src/state/LinkCrawlState.js';
import type { LinkCrawlServices } from '../../../../src/nodes/crawl/Services.js';

/** Minimal context stub — real services are not needed for unit tests. */
export const makeTestContext = (
  services: Partial<LinkCrawlServices> = {},
): NodeContextInterface<LinkCrawlServices> => ({
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
  const s = new LinkCrawlState();
  s.domainRe    = opts.domainRe    ?? 'example\\.com';
  s.targetRe    = opts.targetRe    ?? '\\?id=';
  s.delimiterRe = opts.delimiterRe ?? 'category';
  s.frontier    = opts.frontier    ?? [];
  s.visited     = opts.visited     ?? [];
  s.discovered  = opts.discovered  ?? [];
  s.maxPages    = opts.maxPages;
  s.maxDepth    = opts.maxDepth;
  s.depth       = opts.depth       ?? 0;
  return s;
};
