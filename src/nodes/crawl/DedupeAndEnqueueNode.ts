import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';

import type { LinkCrawlState }   from '../../state/LinkCrawlState.js';
import type { LinkCrawlServices } from './Services.js';

/**
 * Deduplicates the current level's raw link accumulators and promotes them
 * for the next crawl level.
 *
 * @remarks
 * Called once after all frontier URLs have been fetched and extracted for a
 * given depth level. Performs three responsibilities:
 *
 * 1. **Promote discovered targets** — merges `state.discoveredRaw` into
 *    `state.discovered` (deduplicated against the running set).
 * 2. **Build next frontier** — deduplicates `state.nextFrontierRaw` against
 *    `state.visited` and any already-enqueued URLs. Truncates to the
 *    remaining `maxPages` budget.
 * 3. **Advance or stop** — increments `state.depth`, clears the raw
 *    accumulators, and routes to the appropriate output.
 *
 * Output ports:
 * - `frontier-ready`    — new unique URLs in `state.frontier`; next level ready.
 * - `frontier-empty`    — no new traversable URLs found at this level.
 * - `budget-exhausted`  — `maxPages` or `maxDepth` limit reached.
 *
 * @category Nodes
 * @since 3.0.0
 */
class DedupeAndEnqueueNodeImpl extends ScalarNode<
  LinkCrawlState,
  'frontier-ready' | 'frontier-empty' | 'budget-exhausted',
  LinkCrawlServices
> {
  public readonly name = 'crawl:dedupe-and-enqueue';
  public readonly outputs = ['frontier-ready', 'frontier-empty', 'budget-exhausted'] as const;

  protected override async executeOne(
    state: LinkCrawlState,
    context: NodeContextType<LinkCrawlServices>,
  ): Promise<NodeOutputType<'frontier-ready' | 'frontier-empty' | 'budget-exhausted'>> {
    const { services } = context;

    // 1. Promote discovered targets (dedup against running set)
    const discoveredSet = new Set<string>(state.discovered);
    for (const url of state.discoveredRaw) {
      discoveredSet.add(url);
    }
    state.discovered    = Array.from(discoveredSet);
    state.discoveredRaw = [];

    // 2. Check budget and depth limits before building next frontier
    const maxPages = state.maxPages;
    const maxDepth = state.maxDepth;

    if (maxPages !== undefined && state.discovered.length >= maxPages) {
      // Cap at maxPages
      state.discovered = state.discovered.slice(0, maxPages);
      state.frontier   = [];
      state.nextFrontierRaw = [];
      services.log.debug('DedupeAndEnqueueNode', `Budget exhausted: ${state.discovered.length.toString()} pages collected`);
      return NodeOutputBuilder.of('budget-exhausted');
    }

    if (maxDepth !== undefined && state.depth + 1 > maxDepth) {
      state.frontier        = [];
      state.nextFrontierRaw = [];
      services.log.debug('DedupeAndEnqueueNode', `Max depth reached at ${state.depth.toString()}`);
      return NodeOutputBuilder.of('budget-exhausted');
    }

    // 3. Build next frontier
    const visitedSet = new Set<string>(state.visited);
    const seen       = new Set<string>();
    const nextFrontier: string[] = [];

    for (const url of state.nextFrontierRaw) {
      if (visitedSet.has(url)) continue;
      if (seen.has(url)) continue;
      seen.add(url);

      // Respect maxPages budget on traversal too
      if (maxPages !== undefined && state.discovered.length + nextFrontier.length >= maxPages) break;

      nextFrontier.push(url);
    }

    // Clear raw accumulators
    state.nextFrontierRaw = [];
    state.frontier        = nextFrontier;
    state.depth           = state.depth + 1;

    services.log.debug(
      'DedupeAndEnqueueNode',
      `Level ${state.depth.toString()} frontier: ${nextFrontier.length.toString()} URLs`,
    );

    if (nextFrontier.length === 0) return NodeOutputBuilder.of('frontier-empty');
    return NodeOutputBuilder.of('frontier-ready');
  }
}

export const DedupeAndEnqueueNode = new DedupeAndEnqueueNodeImpl();
