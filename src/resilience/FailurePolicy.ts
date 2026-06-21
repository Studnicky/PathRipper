/**
 * FailurePolicy — failure classification interface and default implementation.
 *
 * Types (`FailureContextType`, `FailureRouteType`) live in `src/types/FailurePolicy.ts`.
 * This module provides the interface contract, the default implementation, and
 * the shared metadata key used to stash failure context between nodes.
 *
 * @module resilience/FailurePolicy
 * @since 3.2.0
 */

import type { FailureContextType, FailureRouteType } from '../types/FailurePolicy.js';

export type { FailureContextType, FailureRouteType };

/** Metadata key used to stash a {@link FailureContextType} between the failing node and `route:failure`. */
export const LAST_FAILURE_KEY = 'lastFailure';

/**
 * Contract for classifying a node failure into a routing decision.
 *
 * Implement this interface to customise retry budgets, expected-gap lists,
 * or resolution strategies. Pass the implementation as
 * `services.failurePolicy` to override the default behaviour.
 *
 * @category Resilience
 * @since 3.2.0
 */
export interface FailurePolicyInterface {
  /**
   * Classify a failure context into a routing decision.
   *
   * @param context - The failure context written by the failing node.
   * @returns A {@link FailureRouteType} describing what to do next.
   */
  classify(context: FailureContextType): FailureRouteType;
}

/**
 * Default failure policy: retry transient failures up to `maxRetries` times,
 * then capture permanently.
 *
 * - `retryable && attempt <= maxRetries` → `retry`
 * - otherwise → `capture`
 *
 * @category Resilience
 * @since 3.2.0
 */
export class DefaultFailurePolicy implements FailurePolicyInterface {
  private readonly maxRetries: number;

  public constructor(maxRetries = 2) {
    this.maxRetries = maxRetries;
  }

  public classify(context: FailureContextType): FailureRouteType {
    if (context.retryable && context.attempt <= this.maxRetries) {
      return { route: 'retry' };
    }
    return { route: 'capture' };
  }
}

/** Singleton default policy instance; used when `services.failurePolicy` is absent. */
export const defaultFailurePolicy = new DefaultFailurePolicy();
