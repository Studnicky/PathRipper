import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContract } from '@noocodex/dagonizer/contracts';

import { ExternalSchemaError } from '../errors/ExternalSchemaError.js';
import { Logger }               from '../modules/logger/logger.js';
import { toNodeError }          from './fileUtils.js';
import type { ScrapeState }     from '../state/ScrapeState.js';
import type { RipperServices }     from '../services/RipperServices.js';

/** Crawler config block from `target.cfg.crawler`. */
interface CrawlerBlockInterface {
  readonly startUrls:    ReadonlyArray<string>;
  readonly domain:       string;
  readonly target:       string;
  readonly delimiter:    string;
  readonly rateLimitMs?: number;
  readonly jitterMs?:    number;
  readonly maxPages?:    number;
}

const logger = Logger.forComponent('CrawlListTargetsNode');

/**
 * Walks `services.target.cfg.crawler` seeds via `LinkLister` and writes
 * discovered URLs into `state.urls`.
 *
 * Output ports:
 * - `success` — one or more URLs discovered; `state.urls` populated.
 * - `empty`   — crawler found no matching URLs.
 * - `error`   — crawler config missing or cache absent; error recorded.
 *
 * @category Nodes
 * @since 3.0.0
 */
export const CrawlListTargetsNode: NodeInterface<ScrapeState, 'success' | 'error' | 'empty', RipperServices> = {
  name: 'crawl:list-targets',
  outputs: ['success', 'error', 'empty'],

  async execute(state: ScrapeState, context: NodeContextInterface<RipperServices>): Promise<{ output: 'success' | 'error' | 'empty' }> {
    const { services } = context;
    const crawler = services.target.cfg['crawler'] as CrawlerBlockInterface | undefined;
    if (crawler === undefined) {
      state.collectError(toNodeError(
        ExternalSchemaError.create('crawl:list-targets requires a `crawler` block in target config', { metadata: { target: services.target.id, task: 'crawl:list-targets' } }),
        'crawl:list-targets',
      ));
      return { output: 'error' };
    }
    if (services.cache === null) {
      state.collectError(toNodeError(
        ExternalSchemaError.create('crawl:list-targets requires the orchestrator-supplied shared cache (configure target.cache)', { metadata: { target: services.target.id, task: 'crawl:list-targets' } }),
        'crawl:list-targets',
      ));
      return { output: 'error' };
    }

    const { LinkLister } = await import('../crawlers/LinkLister.js');
    const headers = services.target.cfg['headers'] as Record<string, string> | undefined;
    const lister = LinkLister.create({
      domain:    new RegExp(crawler.domain),
      target:    new RegExp(crawler.target),
      delimiter: new RegExp(crawler.delimiter),
      ...(crawler.rateLimitMs !== undefined ? { rateLimitMs: crawler.rateLimitMs } : {}),
      ...(crawler.jitterMs    !== undefined ? { jitterMs:    crawler.jitterMs    } : {}),
      ...(crawler.maxPages    !== undefined ? { maxPages:    crawler.maxPages    } : {}),
      ...(headers !== undefined ? { headers } : {}),
      cache: services.cache,
    });

    const urls = await lister.buildList(crawler.startUrls);
    state.urls = urls;
    logger.info('crawl:list-targets', `Discovered ${urls.length.toString()} URLs`, {
      task: 'crawl:list-targets', count: urls.length,
    });

    return urls.length > 0 ? { output: 'success' } : { output: 'empty' };
  },
};

/** OperationContract for CrawlListTargetsNode: produces urls from crawler config. */
export const crawlListTargetsContract: OperationContract = {
  name:         'crawl:list-targets',
  hardRequired: [],
  produces:     ['urls'],
  outputs:      ['success', 'error', 'empty'],
};
