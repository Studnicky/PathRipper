// Node: aonprd:taxonomy-route
// Generated at compile time by Taxonomy.compile(). Reads state.page.url,
// looks up the URL in the compiled routing table, routes to the matching
// concept ID or 'unknown', and stores the concept ID in state metadata so the
// subsequent `aonprd:concept-dispatch` node can re-route after the shared
// capability prefix.
import type { NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';

import type { ScrapeState }    from '../../../src/state/ScrapeState.js';
import type { RipperServices } from '../../../src/services/RipperServices.js';
import type { CapabilityNode } from '../taxonomy.js';

/** Metadata key used to carry the routed concept ID across the shared capability prefix. */
export const CONCEPT_ID_KEY = 'aonprdConceptId' as const;

/**
 * Factory that produces the `aonprd:taxonomy-route` router node. Called once
 * by `Taxonomy.compile`; the closure captures the routing table so no global
 * mutable state is required. Stores the resolved concept ID in
 * `state.metadata[CONCEPT_ID_KEY]` so the companion `aonprd:concept-dispatch`
 * node can dispatch to concept-specific chains after the shared capability
 * prefix runs. When URL doesn't resolve, routes to the fallback concept
 * (typically `generic`) instead of `make-unknown` when one is configured.
 */
export function makeTaxonomyRouter(
  routeUrl:        (url: string) => string | null,
  leafConceptIds:  readonly string[],
  fallbackConceptId: string | null = null,
): CapabilityNode {
  const outputs: readonly string[] = fallbackConceptId !== null
    ? [...leafConceptIds, fallbackConceptId, 'unknown']
    : [...leafConceptIds, 'unknown'];

  return {
    name: 'aonprd:taxonomy-route',
    outputs,
    contract: {
      hardRequired: ['page.url'] as const,
      produces:     ['aonprdConceptId'] as const,
    } satisfies OperationContractFragment,

    async execute(
      state:    ScrapeState,
      _ctx:     NodeContextInterface<RipperServices>,
    ): Promise<{ output: string }> {
      const conceptId = routeUrl(state.page.url);
      const resolved  = conceptId ?? fallbackConceptId ?? 'unknown';
      state.setMetadata(CONCEPT_ID_KEY, resolved);
      return { output: resolved };
    },
  };
}

/**
 * Factory that produces a concept-dispatch node. Multiple instances may be
 * registered (one per branch point in the leaf-chain trie). Each instance
 * reads the stored `aonprdConceptId` and emits it as its outcome; the DAG
 * annotations supply different per-concept targets per instance.
 *
 * The default instance name is `aonprd:concept-dispatch` (the post-loadAndCommon
 * dispatcher). Additional branch-point dispatchers receive distinct names
 * (e.g. `aonprd:concept-dispatch-after:extract:source-ref`).
 */
export function makeConceptDispatch(
  leafConceptIds: readonly string[],
  name: string = 'aonprd:concept-dispatch',
): CapabilityNode {
  const outputs: readonly string[] = [...leafConceptIds, 'unknown'];

  return {
    name,
    outputs,
    contract: {
      hardRequired: ['aonprdConceptId'] as const,
      produces:     [] as const,
    } satisfies OperationContractFragment,

    async execute(
      state:    ScrapeState,
      _ctx:     NodeContextInterface<RipperServices>,
    ): Promise<{ output: string }> {
      const conceptId = state.getMetadata<string>(CONCEPT_ID_KEY);
      return { output: conceptId ?? 'unknown' };
    },
  };
}
