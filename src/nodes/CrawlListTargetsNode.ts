import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';

import { ExternalSchemaError } from '../errors/ExternalSchemaError.js';
import { Logger }               from '../modules/logger/logger.js';
import { toNodeError }          from './fileUtils.js';
import type { ScrapeState }     from '../state/ScrapeState.js';
import type { RipperServices }  from '../services/RipperServices.js';

const log = Logger.forComponent('CrawlListTargetsNode');

type CrawlListTargetsOutput = 'success' | 'error' | 'empty';

/**
 * Walks `services.crawler` seeds via `LinkLister` and writes
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
class CrawlListTargetsNodeImpl extends ScalarNode<ScrapeState, CrawlListTargetsOutput, RipperServices> {
  public readonly name = 'crawl:list-targets';
  public readonly outputs = ['success', 'error', 'empty'] as const;

  protected override async executeOne(
    state:   ScrapeState,
    context: NodeContextType<RipperServices>,
  ): Promise<NodeOutputType<CrawlListTargetsOutput>> {
    const { services } = context;
    const crawler = services.crawler;
    if (crawler === undefined) {
      state.collectError(toNodeError(
        ExternalSchemaError.create('crawl:list-targets requires a `crawler` block in target config', { metadata: { target: services.target.id, task: 'crawl:list-targets' } }),
        'crawl:list-targets',
      ));
      return NodeOutputBuilder.of('error');
    }
    if (services.cache === null) {
      state.collectError(toNodeError(
        ExternalSchemaError.create('crawl:list-targets requires the orchestrator-supplied shared cache (configure target.cache)', { metadata: { target: services.target.id, task: 'crawl:list-targets' } }),
        'crawl:list-targets',
      ));
      return NodeOutputBuilder.of('error');
    }

    const { LinkLister } = await import('../crawlers/LinkLister.js');
    const headers = services.headers;
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
    log.info('crawl:list-targets', `Discovered ${urls.length.toString()} URLs`, {
      task: 'crawl:list-targets', count: urls.length,
    });

    return urls.length > 0 ? NodeOutputBuilder.of('success') : NodeOutputBuilder.of('empty');
  }
}

export const CrawlListTargetsNode = new CrawlListTargetsNodeImpl();
