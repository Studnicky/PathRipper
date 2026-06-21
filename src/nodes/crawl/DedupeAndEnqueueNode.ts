import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';

import type { ScrapeState }    from '../../state/ScrapeState.js';
import type { RipperServices } from '../../services/RipperServices.js';

/**
 * Deduplicates the current level's raw link accumulators and promotes them
 * for the next crawl level.
 *
 * @remarks
 * Called once after all frontier URLs have been fetched and extracted for a
 * given depth level. Performs three responsibilities:
 *
 * 1. **Promote discovered targets** — merges `state.crawl.discoveredRaw` into
 *    `state.crawl.discovered` (deduplicated against the running set).
 * 2. **Build next frontier** — deduplicates `state.crawl.nextFrontierRaw`
 *    against `state.crawl.visited`. Truncates to the remaining `maxPages`
 *    budget (read from `services.crawler`).
 * 3. **Advance or stop** — increments `state.crawl.depth`, clears the raw
 *    accumulators, and routes to the appropriate output.
 *
 * Output ports:
 * - `frontier-ready`    — new unique URLs in `state.crawl.frontier`; next level ready.
 * - `frontier-empty`    — no new traversable URLs found at this level.
 * - `budget-exhausted`  — `maxPages` or `maxDepth` limit reached.
 *
 * @category Nodes
 * @since 4.1.0
 */
class DedupeAndEnqueueNodeImpl extends ScalarNode<
  ScrapeState,
  'frontier-ready' | 'frontier-empty' | 'budget-exhausted',
  RipperServices
> {
  public readonly name = 'crawl:dedupe-and-enqueue';
  public readonly outputs = ['frontier-ready', 'frontier-empty', 'budget-exhausted'] as const;

  protected override async executeOne(
    state:   ScrapeState,
    context: NodeContextType<RipperServices>,
  ): Promise<NodeOutputType<'frontier-ready' | 'frontier-empty' | 'budget-exhausted'>> {
    const { services } = context;
    const maxPages = services.crawler?.maxPages;
    const maxDepth = state.crawl.maxDepth;

    // 1. Promote discovered targets (dedup against running set)
    const discoveredSet = new Set<string>(state.crawl.discovered);
    for (const url of state.crawl.discoveredRaw) {
      discoveredSet.add(url);
    }
    state.crawl.discovered    = Array.from(discoveredSet);
    state.crawl.discoveredRaw = [];

    // 2. Check budget and depth limits before building next frontier
    if (maxPages !== undefined && state.crawl.discovered.length >= maxPages) {
      state.crawl.discovered = state.crawl.discovered.slice(0, maxPages);
      state.crawl.frontier       = [];
      state.crawl.nextFrontierRaw = [];
      services.log.debug('DedupeAndEnqueueNode', `Budget exhausted: ${state.crawl.discovered.length.toString()} pages collected`);
      return NodeOutputBuilder.of('budget-exhausted');
    }

    if (maxDepth !== undefined && state.crawl.depth + 1 > maxDepth) {
      state.crawl.frontier        = [];
      state.crawl.nextFrontierRaw = [];
      services.log.debug('DedupeAndEnqueueNode', `Max depth reached at ${state.crawl.depth.toString()}`);
      return NodeOutputBuilder.of('budget-exhausted');
    }

    // 3. Build next frontier
    const visitedSet = new Set<string>(state.crawl.visited);
    const seen       = new Set<string>();
    const nextFrontier: string[] = [];

    for (const url of state.crawl.nextFrontierRaw) {
      if (visitedSet.has(url)) continue;
      if (seen.has(url)) continue;
      seen.add(url);

      if (maxPages !== undefined && state.crawl.discovered.length + nextFrontier.length >= maxPages) break;

      nextFrontier.push(url);
    }

    // Clear raw accumulators
    state.crawl.nextFrontierRaw = [];
    state.crawl.frontier        = nextFrontier;
    state.crawl.depth           = state.crawl.depth + 1;

    services.log.debug(
      'DedupeAndEnqueueNode',
      `Level ${state.crawl.depth.toString()} frontier: ${nextFrontier.length.toString()} URLs`,
    );

    if (nextFrontier.length === 0) return NodeOutputBuilder.of('frontier-empty');
    return NodeOutputBuilder.of('frontier-ready');
  }
}

export const DedupeAndEnqueueNode = new DedupeAndEnqueueNodeImpl();
