import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';

import type { ScrapeState }    from '../../state/ScrapeState.js';
import type { RipperServices } from '../../services/RipperServices.js';

/**
 * Initialises the crawl frontier from `services.crawler.startUrls`.
 *
 * Reads crawl config from `services.crawler` and regex sources from the same,
 * then initialises `state.crawl` ready for the first fetch-and-extract level.
 *
 * Output ports:
 * - `ready` — `state.crawl.frontier` populated; crawl can proceed.
 * - `empty` — `services.crawler.startUrls` was empty or crawler not configured.
 *
 * @category Nodes
 * @since 4.1.0
 */
class InitFrontierNodeImpl extends ScalarNode<ScrapeState, 'ready' | 'empty', RipperServices> {
  public readonly name = 'crawl:init-frontier';
  public readonly outputs = ['ready', 'empty'] as const;

  protected override async executeOne(
    state:   ScrapeState,
    context: NodeContextType<RipperServices>,
  ): Promise<NodeOutputType<'ready' | 'empty'>> {
    const { services } = context;
    const crawler = services.crawler;

    if (crawler === undefined || crawler.startUrls.length === 0) {
      services.log.warn('InitFrontierNode', 'crawl:init-frontier called with no crawler config or empty startUrls');
      return NodeOutputBuilder.of('empty');
    }

    state.crawl = {
      frontier:        [...crawler.startUrls],
      nextFrontierRaw: [],
      discoveredRaw:   [],
      discovered:      [],
      visited:         [],
      depth:           0,
      maxDepth:        undefined,
      domainRe:        crawler.domain,
      targetRe:        crawler.target,
      delimiterRe:     crawler.delimiter,
    };

    services.log.debug('InitFrontierNode', `Frontier initialised with ${state.crawl.frontier.length.toString()} seed(s)`);
    return NodeOutputBuilder.of('ready');
  }
}

export const InitFrontierNode = new InitFrontierNodeImpl();
