import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';

import type { MediaWikiScraper }      from '../../scrapers/MediaWikiScraper.js';
import { toNodeError }                from '../fileUtils.js';
import type { MemberResolutionState } from '../../state/MemberResolutionState.js';
import type { RipperServices }        from '../../services/RipperServices.js';

/** Returns true when the value exposes a `fetchAllPages` method. */
const isWikiScraper = (val: unknown): val is Pick<MediaWikiScraper, 'fetchAllPages'> =>
  typeof val === 'object' && val !== null &&
  typeof (val as { fetchAllPages?: unknown }).fetchAllPages === 'function';

const DEFAULT_MAX_PAGES = 500;

type FetchAllPagesOutput = 'success' | 'error';

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
class FetchAllPagesNodeImpl extends ScalarNode<MemberResolutionState, FetchAllPagesOutput, RipperServices> {
  public readonly name = 'wiki:fetch-all-pages';
  public readonly outputs = ['success', 'error'] as const;

  public override get outputSchema(): Record<FetchAllPagesOutput, SchemaObjectType> {
    return {
      // `success` — `state.members` populated with all main-namespace page titles.
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
      // `error` — scraper absent or API error; error recorded on state; no state delta.
      error: { type: 'object' },
    };
  }

  protected override async executeOne(
    state:   MemberResolutionState,
    context: NodeContextType<RipperServices>,
  ): Promise<NodeOutputType<FetchAllPagesOutput>> {
    const { services } = context;

    if (!isWikiScraper(services.wikiScraper)) {
      state.collectError(toNodeError(
        new Error('wiki:fetch-all-pages requires services.wikiScraper'),
        'wiki:fetch-all-pages',
      ));
      return NodeOutputBuilder.of('error');
    }

    const maxPages = typeof state.config['maxPages'] === 'number'
      ? state.config['maxPages'] as number
      : DEFAULT_MAX_PAGES;

    services.log.info('wiki:fetch-all-pages', 'Mode: all pages in main namespace (this may take a while)');

    try {
      state.members = await services.wikiScraper.fetchAllPages(maxPages);
    } catch (err) {
      state.collectError(toNodeError(err, 'wiki:fetch-all-pages'));
      return NodeOutputBuilder.of('error');
    }

    services.log.info('wiki:fetch-all-pages', `Enumerated ${state.members.length.toString()} pages`);
    return NodeOutputBuilder.of('success');
  }
}

export const FetchAllPagesNode = new FetchAllPagesNodeImpl();
