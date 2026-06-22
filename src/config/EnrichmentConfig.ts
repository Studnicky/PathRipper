/**
 * EnrichmentConfig — typed config for the href-reconcile entity-link enrichment engine.
 *
 * The existing `winknlp` engine (NLP-based entity linking) is orthogonal; this
 * module covers only the `href-reconcile` engine that rewrites link-item skolem
 * nodes back to their canonical entity IRIs.
 */

/** Deduplication mode for in-pass triple dedup during streaming. */
export type DedupeMode = 'inPass' | 'sortUnique' | false;

/**
 * Config for the href-reconcile entity-link engine.
 *
 * Placed at `enrichment.entityLink` in the squashage target config.
 * Activates the `index-entities` pre-scan node and inline
 * `HrefReconciler` in `ontologyProjection`.
 *
 * @example
 * ```json
 * {
 *   "enrichment": {
 *     "entityLink": {
 *       "engine": "href-reconcile",
 *       "linkPredicates": ["https://2e.aonprd.com/links"],
 *       "hrefPredicate": "https://2e.aonprd.com/href",
 *       "canonicalBase": "https://squashage.dev/instance/aonprd/",
 *       "dedupeTriples": "inPass"
 *     }
 *   }
 * }
 * ```
 */
export interface HrefReconcileConfigInterface {
  readonly engine:         'href-reconcile';
  /** Predicates that connect a canonical entity to a link-item node. */
  readonly linkPredicates: ReadonlyArray<string>;
  /** Predicate on a link-item node that carries the resolvable relative href. */
  readonly hrefPredicate:  string;
  /** IRI prefix shared by all canonical entities (must end with `/`). */
  readonly canonicalBase:  string;
  /** Triple deduplication mode. `"inPass"` (default) uses an in-memory hash set. */
  readonly dedupeTriples?: DedupeMode | undefined;
}

/**
 * Narrowing guard: returns true when `raw` is an {@link HrefReconcileConfigInterface}.
 */
export function isHrefReconcileConfig(raw: unknown): raw is HrefReconcileConfigInterface {
  if (typeof raw !== 'object' || raw === null) return false;
  return (raw as Record<string, unknown>)['engine'] === 'href-reconcile';
}
