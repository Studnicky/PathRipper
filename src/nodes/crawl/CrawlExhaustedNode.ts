import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';

import type { ScrapeState }    from '../../state/ScrapeState.js';
import type { RipperServices } from '../../services/RipperServices.js';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * Terminal node for the link-crawl embedded DAG.
 *
 * @remarks
 * Sorts `state.crawl.discovered` with a numeric-aware collator. Applies the
 * `maxPages` cap (from `services.crawler`) as a final safety net — normally
 * handled by `DedupeAndEnqueueNode`, but the terminal pass ensures
 * correctness.
 *
 * Output ports:
 * - `success` — always; `state.crawl.discovered` is the sorted crawl result.
 *
 * @category Nodes
 * @since 4.1.0
 */
class CrawlExhaustedNodeImpl extends ScalarNode<ScrapeState, 'success', RipperServices> {
  public readonly name = 'crawl:exhausted';
  public readonly outputs = ['success'] as const;

  protected override async executeOne(
    state:   ScrapeState,
    context: NodeContextType<RipperServices>,
  ): Promise<NodeOutputType<'success'>> {
    const { services } = context;
    const maxPages = services.crawler?.maxPages;

    // Final dedup + sort
    const deduped = Array.from(new Set(state.crawl.discovered)).sort(collator.compare);

    // Apply maxPages cap
    state.crawl.discovered = maxPages !== undefined
      ? deduped.slice(0, maxPages)
      : deduped;

    services.log.info(
      'CrawlExhaustedNode',
      `Crawl complete: ${state.crawl.discovered.length.toString()} URLs in ${state.crawl.depth.toString()} level(s)`,
    );

    return NodeOutputBuilder.of('success');
  }
}

export const CrawlExhaustedNode = new CrawlExhaustedNodeImpl();
