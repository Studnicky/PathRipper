import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContract } from '@noocodex/dagonizer/contracts';

import type { LinkCrawlState }   from '../../state/LinkCrawlState.js';
import type { LinkCrawlServices } from './Services.js';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * Terminal node for the link-crawl DAG.
 *
 * @remarks
 * Sorts `state.discovered` with a numeric-aware collator to preserve the
 * ordering behaviour of the original `LinkLister` implementation. Applies
 * the `maxPages` cap as a final safety net (normally handled by
 * `DedupeAndEnqueueNode`, but the terminal pass ensures correctness).
 *
 * Output ports:
 * - `success` — always; `state.discovered` is the sorted crawl result.
 *
 * @category Nodes
 * @since 3.0.0
 */
export const CrawlExhaustedNode: NodeInterface<LinkCrawlState, 'success', LinkCrawlServices> = {
  name: 'crawl:exhausted',
  outputs: ['success'],

  async execute(
    state: LinkCrawlState,
    context: NodeContextInterface<LinkCrawlServices>,
  ): Promise<{ output: 'success' }> {
    const { services } = context;

    // Final dedup + sort
    const deduped = Array.from(new Set(state.discovered)).sort(collator.compare);

    // Apply maxPages cap
    state.discovered = state.maxPages !== undefined
      ? deduped.slice(0, state.maxPages)
      : deduped;

    services.log.info(
      'CrawlExhaustedNode',
      `Crawl complete: ${state.discovered.length.toString()} URLs in ${state.depth.toString()} level(s)`,
    );

    return { output: 'success' };
  },
};

/** OperationContract for CrawlExhaustedNode: reads discovered, produces sorted discovered. */
export const crawlExhaustedContract: OperationContract = {
  name:         'crawl:exhausted',
  hardRequired: ['discovered'],
  produces:     ['discovered'],
  outputs:      ['success'],
};
