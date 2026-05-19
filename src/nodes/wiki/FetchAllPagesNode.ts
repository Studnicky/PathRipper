import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContract } from '@noocodex/dagonizer/contracts';

import type { MediaWikiScraper }     from '../../scrapers/MediaWikiScraper.js';
import { toNodeError }               from '../fileUtils.js';
import type { MemberResolutionState } from '../../state/MemberResolutionState.js';
import type { RipperServices }           from '../../services/RipperServices.js';

/** Returns true when the value exposes a `fetchAllPages` method. */
const isWikiScraper = (s: unknown): s is Pick<MediaWikiScraper, 'fetchAllPages'> =>
  typeof s === 'object' && s !== null &&
  typeof (s as { fetchAllPages?: unknown }).fetchAllPages === 'function';

const DEFAULT_MAX_PAGES = 500;

/**
 * Enumerates every article in the wiki's main namespace via
 * `services.wikiScraper.fetchAllPages()` and writes results to `state.members`.
 *
 * The per-call batch size is taken from `state.config.maxPages` (default 500).
 *
 * Output ports:
 * - `success` — enumeration complete; `state.members` populated.
 * - `error`   — scraper absent or API error.
 *
 * @category Nodes
 * @since 3.0.0
 */
export const FetchAllPagesNode: NodeInterface<
  MemberResolutionState,
  'success' | 'error',
  RipperServices
> = {
  name: 'wiki:fetch-all-pages',
  outputs: ['success', 'error'],

  async execute(
    state:   MemberResolutionState,
    context: NodeContextInterface<RipperServices>,
  ): Promise<{ output: 'success' | 'error' }> {
    const { services } = context;

    if (!isWikiScraper(services.wikiScraper)) {
      state.collectError(toNodeError(
        new Error('wiki:fetch-all-pages requires services.wikiScraper'),
        'wiki:fetch-all-pages',
      ));
      return { output: 'error' };
    }

    const maxPages = typeof state.config['maxPages'] === 'number'
      ? state.config['maxPages'] as number
      : DEFAULT_MAX_PAGES;

    services.log.info('wiki:fetch-all-pages', 'Mode: all pages in main namespace (this may take a while)');

    try {
      state.members = await services.wikiScraper.fetchAllPages(maxPages);
    } catch (err) {
      state.collectError(toNodeError(err, 'wiki:fetch-all-pages'));
      return { output: 'error' };
    }

    services.log.info('wiki:fetch-all-pages', `Enumerated ${state.members.length.toString()} pages`);
    return { output: 'success' };
  },
};

/** OperationContract for FetchAllPagesNode: produces members from full namespace enumeration. */
export const fetchAllPagesContract: OperationContract = {
  name:         'wiki:fetch-all-pages',
  hardRequired: [],
  produces:     ['members'],
  outputs:      ['success', 'error'],
};
