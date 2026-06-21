/**
 * Reconciler type contracts.
 *
 * These types flow between `reconcile:identity` (which builds the index and
 * runs resolution) and `report:crawl-health` (which consumes the summary).
 * Plugin implementors of {@link ReconcilerInterface} depend on these types.
 *
 * @module types/Reconciler
 * @since 3.2.0
 */

/**
 * Resolution decision for a captured failure.
 *
 * The discriminant field `status` identifies which case applied:
 * - `capturedElsewhere` — the concept was successfully scraped at a different
 *   URL; the dead link is harmless.
 * - `missing`           — no concept matching this failure was found anywhere
 *   in the captured output; data may be absent.
 * - `dead`              — the resource is known to not exist (lore-only, etc.);
 *   the failure is expected and should not count against completeness.
 *
 * @category Resilience
 * @since 3.2.0
 */
export type ResolutionType =
  | { readonly status: 'capturedElsewhere'; readonly at: string }
  | { readonly status: 'missing' }
  | { readonly status: 'dead'; readonly reason: string };

/**
 * A captured failure document as passed to
 * {@link ReconcilerInterface.resolveFailure}.
 *
 * Mirrors the subset of an `error:capture` output doc that identity matching
 * needs; the full doc on disk may contain additional fields.
 *
 * @category Resilience
 * @since 3.2.0
 */
export type CapturedFailureType = {
  readonly url: string;
  readonly errors: readonly {
    readonly code: string;
    readonly message: string;
    readonly operation: string;
  }[];
};

/**
 * Identity index built from successfully scraped concept docs.
 *
 * Maps an index key (e.g. a concept name, slug, or id) to the list of URLs
 * where that key was captured. A key may appear in multiple docs if the site
 * has duplicates; reconciliation uses membership to decide `capturedElsewhere`.
 *
 * @category Resilience
 * @since 3.2.0
 */
export type IdentityIndexType = ReadonlyMap<string, readonly string[]>;

/**
 * Aggregated reconciliation summary produced by `reconcile:identity` and
 * consumed by `report:crawl-health`.
 *
 * @category Resilience
 * @since 3.2.0
 */
export type ReconciliationSummaryType = {
  readonly totals: {
    readonly concepts: number;
    readonly failures: number;
    readonly capturedElsewhere: number;
    readonly missing: number;
    readonly dead: number;
  };
  readonly capturedElsewhere: readonly { readonly url: string; readonly at: string }[];
  readonly missing: readonly {
    readonly url: string;
    readonly errors: readonly { readonly code: string; readonly message: string }[];
  }[];
  readonly dead: readonly { readonly url: string; readonly reason: string }[];
};
