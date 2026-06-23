// Node factories: taxonomy-route and concept-dispatch.
//
// Generated at compile time by Taxonomy.compile(). The taxonomy-route node
// reads state.page.url, looks up the URL in the compiled routing table,
// routes to the matching concept ID or 'unknown', and stores the concept ID
// in state metadata so a subsequent concept-dispatch node can re-route after
// the shared capability prefix.
//
// All node names and metadata keys are derived from the namespace supplied
// at compile time — no hardcoded plugin-specific strings appear here.
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';

import type { ScrapeState }    from '../state/ScrapeState.js';
import type { CapabilityNode } from './Taxonomy.js';

/**
 * Returns the metadata key used to carry the routed concept ID across the
 * shared capability prefix. Derived from the plugin namespace.
 * E.g. namespace 'aonprd' → 'aonprdConceptId'.
 */
export function conceptIdKey(namespace: string): string {
  return `${namespace}ConceptId`;
}

/**
 * Factory that produces the `${namespace}:taxonomy-route` router node. Called
 * once by `Taxonomy.compile`; the closure captures the routing table so no
 * global mutable state is required. Stores the resolved concept ID in
 * `state.metadata[conceptIdKey(namespace)]` so the companion concept-dispatch
 * node can dispatch to concept-specific chains after the shared capability
 * prefix runs. When the URL does not resolve, routes to the fallback concept
 * instead of 'unknown' when one is configured.
 */
export function makeTaxonomyRouter(
  routeUrl:          (url: string) => string | null,
  leafConceptIds:    readonly string[],
  namespace:         string,
  fallbackConceptId: string | null = null,
): CapabilityNode {
  const outputs: readonly string[] = fallbackConceptId !== null
    ? [...leafConceptIds, fallbackConceptId, 'unknown']
    : [...leafConceptIds, 'unknown'];

  const nodeName  = `${namespace}:taxonomy-route`;
  const metaKey   = conceptIdKey(namespace);

  class TaxonomyRouterNode extends ScalarNode<ScrapeState, string> {
    public readonly name    = nodeName;
    public readonly outputs = outputs;

    public override get outputSchema(): Record<string, SchemaObjectType> {
      // Dynamic routing node — port names are concept IDs resolved at compile
      // time. Routing to any port writes only the namespace concept ID metadata
      // key (not an enumerable state field), so every port carries the same
      // open-object contract. Built from `outputs` so the schema covers every
      // declared port, as the engine requires.
      return Object.fromEntries(outputs.map((port): [string, SchemaObjectType] => [port, { type: 'object' }]));
    }

    protected override async executeOne(
      state: ScrapeState,
      _ctx:  NodeContextType,
    ): Promise<NodeOutputType<string>> {
      const conceptId = routeUrl(state.page.url);
      const resolved  = conceptId ?? fallbackConceptId ?? 'unknown';
      state.setMetadata(metaKey, resolved);
      return NodeOutputBuilder.of(resolved);
    }
  }

  return new TaxonomyRouterNode();
}

/**
 * Factory that produces a concept-dispatch node. Multiple instances may be
 * registered (one per branch point in the leaf-chain trie). Each instance
 * reads the stored namespace concept ID and emits it as its outcome; the DAG
 * annotations supply different per-concept targets per instance.
 *
 * The `name` param is required — callers compute the fully-qualified name
 * (e.g. `${namespace}:concept-dispatch` or
 * `${namespace}:concept-dispatch-after:${branchPointKey}`).
 */
export function makeConceptDispatch(
  leafConceptIds: readonly string[],
  name:           string,
  namespace:      string,
): CapabilityNode {
  const outputs: readonly string[] = [...leafConceptIds, 'unknown'];
  const nodeName = name;
  const metaKey  = conceptIdKey(namespace);

  class ConceptDispatchNode extends ScalarNode<ScrapeState, string> {
    public readonly name    = nodeName;
    public readonly outputs = outputs;

    public override get outputSchema(): Record<string, SchemaObjectType> {
      // Dynamic dispatch node — port names are concept IDs resolved at compile
      // time. Re-emits the stored namespace concept ID; no state delta. Built
      // from `outputs` so the schema covers every declared port.
      return Object.fromEntries(outputs.map((port): [string, SchemaObjectType] => [port, { type: 'object' }]));
    }

    protected override async executeOne(
      state: ScrapeState,
      _ctx:  NodeContextType,
    ): Promise<NodeOutputType<string>> {
      const conceptId = state.getMetadata<string>(metaKey);
      return NodeOutputBuilder.of(conceptId ?? 'unknown');
    }
  }

  return new ConceptDispatchNode();
}
