import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';

import type { CategoryMemberInterface } from '../../types/MediaWikiScraper.js';
import type { MediaWikiScraper }        from '../../scrapers/MediaWikiScraper.js';
import { toNodeError }                  from '../fileUtils.js';
import type { MemberResolutionState }   from '../../state/MemberResolutionState.js';
import type { RipperServices }          from '../../services/RipperServices.js';

/** Returns true when the value exposes a `fetchCategory` method. */
const isWikiScraper = (val: unknown): val is Pick<MediaWikiScraper, 'fetchCategory'> =>
  typeof val === 'object' && val !== null &&
  typeof (val as { fetchCategory?: unknown }).fetchCategory === 'function';

type FetchMultipleCategoriesOutput = 'success' | 'error';

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
class FetchMultipleCategoriesNodeImpl extends ScalarNode<MemberResolutionState, FetchMultipleCategoriesOutput, RipperServices> {
  public readonly name = 'wiki:fetch-multiple-categories';
  public readonly outputs = ['success', 'error'] as const;

  protected override async executeOne(
    state:   MemberResolutionState,
    context: NodeContextType<RipperServices>,
  ): Promise<NodeOutputType<FetchMultipleCategoriesOutput>> {
    const { services } = context;

    if (!isWikiScraper(services.wikiScraper)) {
      state.collectError(toNodeError(
        new Error('wiki:fetch-multiple-categories requires services.wikiScraper'),
        'wiki:fetch-multiple-categories',
      ));
      return NodeOutputBuilder.of('error');
    }

    const configCategories = state.config['categories'];
    const categories: string[] = Array.isArray(configCategories)
      ? (configCategories as unknown[]).filter((cat): cat is string => typeof cat === 'string')
      : [];

    const seen    = new Set<string>();
    const members: CategoryMemberInterface[] = [];

    try {
      for (const cat of categories) {
        const batch = await services.wikiScraper.fetchCategory(cat);
        for (const member of batch) {
          if (!seen.has(member.title)) {
            seen.add(member.title);
            members.push(member);
          }
        }
      }
    } catch (err) {
      state.collectError(toNodeError(err, 'wiki:fetch-multiple-categories'));
      return NodeOutputBuilder.of('error');
    }

    state.members = members;
    services.log.info('wiki:fetch-multiple-categories',
      `Mode: ${categories.length.toString()} categories — ${members.length.toString()} unique pages`);
    return NodeOutputBuilder.of('success');
  }
}

export const FetchMultipleCategoriesNode = new FetchMultipleCategoriesNodeImpl();
