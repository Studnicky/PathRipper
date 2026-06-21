import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';

import type { MediaWikiScraper }      from '../../scrapers/MediaWikiScraper.js';
import { toNodeError }                from '../fileUtils.js';
import type { MemberResolutionState } from '../../state/MemberResolutionState.js';
import type { RipperServices }        from '../../services/RipperServices.js';

/** Returns true when the value exposes a `fetchCategory` method. */
const isWikiScraper = (val: unknown): val is Pick<MediaWikiScraper, 'fetchCategory'> =>
  typeof val === 'object' && val !== null &&
  typeof (val as { fetchCategory?: unknown }).fetchCategory === 'function';

type FetchSingleCategoryOutput = 'success' | 'error';

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
class FetchSingleCategoryNodeImpl extends ScalarNode<MemberResolutionState, FetchSingleCategoryOutput, RipperServices> {
  public readonly name = 'wiki:fetch-single-category';
  public readonly outputs = ['success', 'error'] as const;

  public override get outputSchema(): Record<FetchSingleCategoryOutput, SchemaObjectType> {
    return {
      // `success` — `state.members` populated with members of `state.category`.
      success: {
        type: 'object',
        properties: {
          members: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title:  { type: 'string' },
                pageid: { type: 'integer' },
              },
              required: ['title', 'pageid'],
            },
          },
        },
        required: ['members'],
      },
      // `error` — scraper absent, category undefined, or API error; error recorded on state; no state delta.
      error: { type: 'object' },
    };
  }

  protected override async executeOne(
    state:   MemberResolutionState,
    context: NodeContextType<RipperServices>,
  ): Promise<NodeOutputType<FetchSingleCategoryOutput>> {
    const { services } = context;

    if (!isWikiScraper(services.wikiScraper)) {
      state.collectError(toNodeError(
        new Error('wiki:fetch-single-category requires services.wikiScraper'),
        'wiki:fetch-single-category',
      ));
      return NodeOutputBuilder.of('error');
    }

    if (state.category === undefined) {
      state.collectError(toNodeError(
        new Error('wiki:fetch-single-category requires state.category to be set'),
        'wiki:fetch-single-category',
      ));
      return NodeOutputBuilder.of('error');
    }

    try {
      state.members = await services.wikiScraper.fetchCategory(state.category);
    } catch (err) {
      state.collectError(toNodeError(err, 'wiki:fetch-single-category'));
      return NodeOutputBuilder.of('error');
    }

    services.log.info('wiki:fetch-single-category',
      `Mode: single category "${state.category}" — ${state.members.length.toString()} pages`);
    return NodeOutputBuilder.of('success');
  }
}

export const FetchSingleCategoryNode = new FetchSingleCategoryNodeImpl();
