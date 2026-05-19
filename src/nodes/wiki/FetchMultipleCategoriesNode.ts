import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContract } from '@noocodex/dagonizer/contracts';

import type { CategoryMemberInterface } from '../../types/MediaWikiScraper.js';
import type { MediaWikiScraper }        from '../../scrapers/MediaWikiScraper.js';
import { toNodeError }                  from '../fileUtils.js';
import type { MemberResolutionState }   from '../../state/MemberResolutionState.js';
import type { RipperServices }             from '../../services/RipperServices.js';

/** Returns true when the value exposes a `fetchCategory` method. */
const isWikiScraper = (s: unknown): s is Pick<MediaWikiScraper, 'fetchCategory'> =>
  typeof s === 'object' && s !== null &&
  typeof (s as { fetchCategory?: unknown }).fetchCategory === 'function';

/**
 * Fetches members from all categories listed in `state.config.categories`,
 * deduplicating by title, and writes results to `state.members`.
 *
 * Output ports:
 * - `success` — all categories fetched; `state.members` populated (may be empty array).
 * - `error`   — scraper absent or API error.
 *
 * @category Nodes
 * @since 3.0.0
 */
export const FetchMultipleCategoriesNode: NodeInterface<
  MemberResolutionState,
  'success' | 'error',
  RipperServices
> = {
  name: 'wiki:fetch-multiple-categories',
  outputs: ['success', 'error'],

  async execute(
    state:   MemberResolutionState,
    context: NodeContextInterface<RipperServices>,
  ): Promise<{ output: 'success' | 'error' }> {
    const { services } = context;

    if (!isWikiScraper(services.wikiScraper)) {
      state.collectError(toNodeError(
        new Error('wiki:fetch-multiple-categories requires services.wikiScraper'),
        'wiki:fetch-multiple-categories',
      ));
      return { output: 'error' };
    }

    const configCategories = state.config['categories'];
    const categories: string[] = Array.isArray(configCategories)
      ? (configCategories as unknown[]).filter((c): c is string => typeof c === 'string')
      : [];

    const seen    = new Set<string>();
    const members: CategoryMemberInterface[] = [];

    try {
      for (const cat of categories) {
        const batch = await services.wikiScraper.fetchCategory(cat);
        for (const m of batch) {
          if (!seen.has(m.title)) {
            seen.add(m.title);
            members.push(m);
          }
        }
      }
    } catch (err) {
      state.collectError(toNodeError(err, 'wiki:fetch-multiple-categories'));
      return { output: 'error' };
    }

    state.members = members;
    services.log.info('wiki:fetch-multiple-categories',
      `Mode: ${categories.length.toString()} categories — ${members.length.toString()} unique pages`);
    return { output: 'success' };
  },
};

/** OperationContract for FetchMultipleCategoriesNode: produces members from configured categories. */
export const fetchMultipleCategoriesContract: OperationContract = {
  name:         'wiki:fetch-multiple-categories',
  hardRequired: [],
  produces:     ['members'],
  outputs:      ['success', 'error'],
};
