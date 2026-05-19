import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContract } from '@noocodex/dagonizer/contracts';

import type { MediaWikiScraper }     from '../../scrapers/MediaWikiScraper.js';
import { toNodeError }               from '../fileUtils.js';
import type { MemberResolutionState } from '../../state/MemberResolutionState.js';
import type { RipperServices }           from '../../services/RipperServices.js';

/** Returns true when the value exposes a `fetchCategory` method. */
const isWikiScraper = (s: unknown): s is Pick<MediaWikiScraper, 'fetchCategory'> =>
  typeof s === 'object' && s !== null &&
  typeof (s as { fetchCategory?: unknown }).fetchCategory === 'function';

/**
 * Fetches members of the single category named in `state.category` via
 * `services.wikiScraper.fetchCategory()` and writes results to `state.members`.
 *
 * Output ports:
 * - `success` — category fetched; `state.members` populated.
 * - `error`   — scraper absent, category undefined, or API error.
 *
 * @category Nodes
 * @since 3.0.0
 */
export const FetchSingleCategoryNode: NodeInterface<
  MemberResolutionState,
  'success' | 'error',
  RipperServices
> = {
  name: 'wiki:fetch-single-category',
  outputs: ['success', 'error'],

  async execute(
    state:   MemberResolutionState,
    context: NodeContextInterface<RipperServices>,
  ): Promise<{ output: 'success' | 'error' }> {
    const { services } = context;

    if (!isWikiScraper(services.wikiScraper)) {
      state.collectError(toNodeError(
        new Error('wiki:fetch-single-category requires services.wikiScraper'),
        'wiki:fetch-single-category',
      ));
      return { output: 'error' };
    }

    if (state.category === undefined) {
      state.collectError(toNodeError(
        new Error('wiki:fetch-single-category requires state.category to be set'),
        'wiki:fetch-single-category',
      ));
      return { output: 'error' };
    }

    try {
      state.members = await services.wikiScraper.fetchCategory(state.category);
    } catch (err) {
      state.collectError(toNodeError(err, 'wiki:fetch-single-category'));
      return { output: 'error' };
    }

    services.log.info('wiki:fetch-single-category',
      `Mode: single category "${state.category}" — ${state.members.length.toString()} pages`);
    return { output: 'success' };
  },
};

/** OperationContract for FetchSingleCategoryNode: produces members from a category. */
export const fetchSingleCategoryContract: OperationContract = {
  name:         'wiki:fetch-single-category',
  hardRequired: ['category'],
  produces:     ['members'],
  outputs:      ['success', 'error'],
};
