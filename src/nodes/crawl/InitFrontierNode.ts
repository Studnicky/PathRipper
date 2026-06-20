import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';

import type { LinkCrawlState }   from '../../state/LinkCrawlState.js';
import type { LinkCrawlServices } from './Services.js';

/**
 * Initialises the crawl frontier from `state.seedUrls`.
 *
 * Output ports:
 * - `ready` — `state.frontier` populated; crawl can proceed.
 * - `empty` — `state.seedUrls` was empty; nothing to crawl.
 *
 * @category Nodes
 * @since 3.0.0
 */
class InitFrontierNodeImpl extends ScalarNode<LinkCrawlState, 'ready' | 'empty', LinkCrawlServices> {
  public readonly name = 'crawl:init-frontier';
  public readonly outputs = ['ready', 'empty'] as const;

  protected override async executeOne(
    state: LinkCrawlState,
    context: NodeContextType<LinkCrawlServices>,
  ): Promise<NodeOutputType<'ready' | 'empty'>> {
    const { services } = context;
    if (state.seedUrls.length === 0) {
      services.log.warn('InitFrontierNode', 'crawl:init-frontier called with empty seedUrls');
      return NodeOutputBuilder.of('empty');
    }

    state.frontier        = [...state.seedUrls];
    state.visited         = [];
    state.discovered      = [];
    state.discoveredRaw   = [];
    state.nextFrontierRaw = [];
    state.depth           = 0;

    services.log.debug('InitFrontierNode', `Frontier initialised with ${state.frontier.length.toString()} seed(s)`);
    return NodeOutputBuilder.of('ready');
  }
}

export const InitFrontierNode = new InitFrontierNodeImpl();
