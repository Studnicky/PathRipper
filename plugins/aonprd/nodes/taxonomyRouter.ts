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
 * Factory that produces the `aonprd:taxonomy-route` router node.
 * Called once by `Taxonomy.compile`; the closure captures the routing table
 * so no global mutable state is required.
 *
 * Stores the resolved concept ID in `state.metadata[CONCEPT_ID_KEY]` so the
 * companion `aonprd:concept-dispatch` node can dispatch to concept-specific
 * chains after the shared capability prefix runs.
 *
 * Wave 6 M1: when routing resolves to a known concept, the concept's static
 * `discriminator` (declared on `ConceptDecl`) is stamped onto `state.output`
 * before downstream capabilities run. This implements the discriminator
 * contract structurally — concept extract/finalize nodes no longer need to
 * hand-stamp `_type` literals.
 */
export function makeTaxonomyRouter(
  routeUrl:        (url: string) => string | null,
  leafConceptIds:  readonly string[],
  discriminatorFor: (conceptId: string) => Readonly<Record<string, unknown>>,
  fallbackConceptId: string | null = null,
): CapabilityNode {
  // Wave 7 M7: include the fallback concept ID as a valid output so the DAG
  // annotations can route to its chain. If no fallback is configured, the
  // 'unknown' outcome routes to `aonprd:make-unknown` as before.
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
      // Wave 7 M7: when URL doesn't resolve, route to the fallback concept
      // (typically `generic`) instead of `make-unknown`. Operators see the
      // fallback being hit via the concept's `_type` discriminator + the
      // contract warning emitted in parse.taxonomic.ts end-of-chain.
      const resolved  = conceptId ?? fallbackConceptId ?? 'unknown';
      // Store for aonprd:concept-dispatch to re-route after shared prefix.
      state.setMetadata(CONCEPT_ID_KEY, resolved);
      // Wave 6 M1: stamp the concept's discriminator (e.g. `{ _type: 'language' }`)
      // onto state.output so downstream caps can read it. No-op for 'unknown'
      // or concepts without a declared discriminator.
      const discriminator = discriminatorFor(resolved);
      if (Object.keys(discriminator).length > 0) {
        state.output = { ...state.output, ...discriminator };
      }
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
