/**
 * Reconciler — identity matching interface and default implementation.
 *
 * Types (`ResolutionType`, `CapturedFailureType`, `CapturedConceptType`,
 * `ReconciliationSummaryType`) live in `src/types/Reconciler.ts`.
 * This module provides the interface contract, the default implementation,
 * and the shared metadata key used to hand the summary between nodes.
 *
 * @module resilience/Reconciler
 * @since 3.2.0
 */

export type {
  ResolutionType,
  CapturedFailureType,
  CapturedConceptType,
  ReconciliationSummaryType,
} from '../types/Reconciler.js';

import type {
  ResolutionType,
  CapturedFailureType,
  CapturedConceptType,
} from '../types/Reconciler.js';

/** Metadata key used to pass the reconciliation summary from `reconcile:identity` to `report:crawl-health`. */
export const RECONCILIATION_KEY = 'reconciliation';

/**
 * Contract for identity-based failure resolution.
 *
 * Implement this interface to define what "identity" means for a target site
 * and how a captured failure matches a known concept. Pass the implementation
 * as `services.reconciler` to override the default conservative behaviour.
 *
 * The framework owns the mechanism (scan, prepare, aggregate); the plugin owns
 * the semantics (what index shape to build, how to match failures).
 *
 * `TIndex` is the opaque index shape produced by `prepare` and consumed by
 * `resolveFailure`. The node never inspects it — it just threads it through.
 *
 * @category Resilience
 * @since 3.2.0
 */
export interface ReconcilerInterface<TIndex = unknown> {
  /**
   * Build an opaque identity index from the full set of successfully scraped
   * concept docs.
   *
   * The returned index is passed verbatim to every `resolveFailure` call.
   * The framework never reads or transforms it.
   *
   * @param concepts - All successfully scraped concept docs for this run.
   * @returns An opaque index whose shape is defined by the implementation.
   */
  prepare(concepts: readonly CapturedConceptType[]): TIndex;

  /**
   * Decide the resolution status for a single captured failure.
   *
   * @param failure - The captured error document (url + error list).
   * @param index   - The opaque index built by `prepare`.
   * @returns A {@link ResolutionType} describing how the failure resolved.
   */
  resolveFailure(failure: CapturedFailureType, index: TIndex): ResolutionType;
}

/**
 * Default reconciler: conservative no-op.
 *
 * `prepare` returns `null` (no indexing), so every failure resolves to
 * `missing`. Targets without a plugin reconciler still produce a valid,
 * complete report — just with all failures classified as missing.
 *
 * @category Resilience
 * @since 3.2.0
 */
export class DefaultReconciler implements ReconcilerInterface<null> {
  public prepare(_concepts: readonly CapturedConceptType[]): null {
    return null;
  }

  public resolveFailure(
    _failure: CapturedFailureType,
    _index: null,
  ): ResolutionType {
    return { status: 'missing' };
  }
}

/** Singleton default reconciler; used when `services.reconciler` is absent. */
export const defaultReconciler = new DefaultReconciler();
