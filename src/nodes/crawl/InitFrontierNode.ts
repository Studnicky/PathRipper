import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContract } from '@noocodex/dagonizer/contracts';

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
export const InitFrontierNode: NodeInterface<LinkCrawlState, 'ready' | 'empty', LinkCrawlServices> = {
  name: 'crawl:init-frontier',
  outputs: ['ready', 'empty'],

  async execute(
    state: LinkCrawlState,
    context: NodeContextInterface<LinkCrawlServices>,
  ): Promise<{ output: 'ready' | 'empty' }> {
    const { services } = context;
    if (state.seedUrls.length === 0) {
      services.log.warn('InitFrontierNode', 'crawl:init-frontier called with empty seedUrls');
      return { output: 'empty' };
    }

    state.frontier        = [...state.seedUrls];
    state.visited         = [];
    state.discovered      = [];
    state.discoveredRaw   = [];
    state.nextFrontierRaw = [];
    state.depth           = 0;

    services.log.debug('InitFrontierNode', `Frontier initialised with ${state.frontier.length.toString()} seed(s)`);
    return { output: 'ready' };
  },
};

/** OperationContract for InitFrontierNode: reads seedUrls, produces frontier. */
export const initFrontierContract: OperationContract = {
  name:         'crawl:init-frontier',
  hardRequired: ['seedUrls'],
  produces:     ['frontier'],
  outputs:      ['ready', 'empty'],
};
