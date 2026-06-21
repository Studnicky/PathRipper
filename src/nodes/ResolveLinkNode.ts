import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';

import type { ScrapeState }     from '../state/ScrapeState.js';
import type { RipperServices }  from '../services/RipperServices.js';
import { LAST_FAILURE_KEY }     from '../resilience/FailurePolicy.js';
import type { FailureContextType } from '../resilience/FailurePolicy.js';
import { LinkResolverRegistry } from '../resilience/LinkResolve.js';

type ResolveLinkOutput = 'resolved' | 'unresolved';

/**
 * Opt-in link-resolution node that attempts to recover a wrong-locator URL
 * before giving up. Runs after `route:failure` emits `resolve` and before
 * `error:capture`.
 *
 * When a corrected URL is found, stashes it under `state.setMetadata('currentUrl', corrected)`
 * so that the downstream `html:fetch` node picks it up.
 *
 * Output ports:
 * - `resolved`   — a corrected URL was found; `currentUrl` metadata is updated.
 * - `unresolved` — no strategy succeeded; route to `error:capture`.
 *
 * This node is strictly opt-in: with no `services.resolve` and no
 * `'resolveStrategies'` metadata, it immediately routes `unresolved`.
 * AON does not configure `services.resolve`, so for AON this node is dormant.
 *
 * @category Nodes
 * @since 3.2.0
 */
class ResolveLinkNodeImpl extends ScalarNode<ScrapeState, ResolveLinkOutput, RipperServices> {
  public readonly name = 'resolve:link';
  public readonly outputs = ['resolved', 'unresolved'] as const;

  public override get outputSchema(): Record<ResolveLinkOutput, SchemaObjectType> {
    return {
      // `resolved` — `currentUrl` metadata is set to the corrected URL.
      // Metadata is not an enumerable state field; the key name is `currentUrl`.
      resolved:   { type: 'object' },
      // `unresolved` — no strategy succeeded; proceed to error:capture.
      unresolved: { type: 'object' },
    };
  }

  protected override async executeOne(
    state:   ScrapeState,
    context: NodeContextType<RipperServices>,
  ): Promise<NodeOutputType<ResolveLinkOutput>> {
    const { services } = context;

    // Read the failed URL from stashed failure context, fall back to page URL.
    const stashed = state.getMetadata<FailureContextType>(LAST_FAILURE_KEY);
    const failedUrl = stashed?.url ?? state.page.url;

    // Enforce resolve budget (default 2).
    const budget  = services.resolve?.budget ?? 2;
    const attempt = state.recordAttempt('resolve');
    if (attempt > budget) {
      state.clearAttempts('resolve');
      return NodeOutputBuilder.of('unresolved');
    }

    // Strategy names: from metadata (set by route:failure) or from services config.
    const strategyNames = state.getMetadata<string[]>('resolveStrategies')
      ?? services.resolve?.strategies
      ?? [];

    if (strategyNames.length === 0) {
      return NodeOutputBuilder.of('unresolved');
    }

    for (const name of strategyNames) {
      const strategy = LinkResolverRegistry.get(name);
      if (strategy === undefined) continue;

      const corrected = await strategy.resolve(failedUrl, services);
      if (corrected !== null) {
        state.setMetadata('currentUrl', corrected);
        services.log.info('resolve:link', `resolved ${failedUrl} → ${corrected} via ${name}`);
        return NodeOutputBuilder.of('resolved');
      }
    }

    // No strategy succeeded.
    state.clearAttempts('resolve');
    return NodeOutputBuilder.of('unresolved');
  }
}

export const ResolveLinkNode = new ResolveLinkNodeImpl();
