/**
 * Reconciler — identity matching interface and default implementation.
 *
 * Types (`ResolutionType`, `CapturedFailureType`, `IdentityIndexType`,
 * `ReconciliationSummaryType`) live in `src/types/Reconciler.ts`.
 * This module provides the interface contract, the default implementation,
 * and the shared metadata key used to hand the summary between nodes.
 *
 * @module resilience/Reconciler
 * @since 3.2.0
 */

import type {
  ResolutionType,
  CapturedFailureType,
  IdentityIndexType,
} from '../types/Reconciler.js';

export type {
  ResolutionType,
  CapturedFailureType,
  IdentityIndexType,
  ReconciliationSummaryType,
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
 * The framework owns the mechanism (scan, index, aggregate); the plugin owns
 * the semantics (what keys to emit, how to match).
 *
 * @category Resilience
 * @since 3.2.0
 */
export interface ReconcilerInterface {
  /**
   * Emit zero or more identity keys for a successfully scraped concept doc.
   *
   * The returned keys are inserted into the identity index. A failure doc is
   * considered `capturedElsewhere` if its reconciler resolves it to a key that
   * appears in the index.
   *
   * @param url    - The URL the concept was scraped from.
   * @param output - The full parsed concept document.
   * @returns An array of index keys (e.g. name, slug, id). Empty → not indexed.
   */
  indexConcept(url: string, output: Record<string, unknown>): readonly string[];

  /**
   * Decide the resolution status for a single captured failure.
   *
   * @param failure - The captured error document (url + error list).
   * @param index   - The identity index built from all concept docs.
   * @returns A {@link ResolutionType} describing how the failure resolved.
   */
  resolveFailure(failure: CapturedFailureType, index: IdentityIndexType): ResolutionType;
}

/**
 * Default reconciler: conservative no-op.
 *
 * `indexConcept` returns an empty array (no indexing), so every failure
 * resolves to `missing`. Targets without a plugin reconciler still produce
 * a valid, complete report — just with all failures classified as missing.
 *
 * @category Resilience
 * @since 3.2.0
 */
export class DefaultReconciler implements ReconcilerInterface {
  public indexConcept(_url: string, _output: Record<string, unknown>): readonly string[] {
    return [];
  }

  public resolveFailure(
    _failure: CapturedFailureType,
    _index: IdentityIndexType,
  ): ResolutionType {
    return { status: 'missing' };
  }
}

/** Singleton default reconciler; used when `services.reconciler` is absent. */
export const defaultReconciler = new DefaultReconciler();
