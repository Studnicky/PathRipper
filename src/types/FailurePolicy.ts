/**
 * Failure policy type contracts.
 *
 * These types flow between the failing node (`html:fetch`) and the routing
 * node (`route:failure`), and are also consumed by `FailurePolicyInterface`
 * implementors.
 *
 * @module types/FailurePolicy
 * @since 3.2.0
 */

/**
 * Context describing a node failure, written to state metadata under
 * `LAST_FAILURE_KEY` by the failing node so `route:failure` can classify it.
 *
 * @category Resilience
 * @since 3.2.0
 */
export type FailureContextType = {
  /** The URL that was being fetched when the failure occurred. */
  readonly url: string;
  /** HTTP response status code, if the failure was an HTTP error. */
  readonly status: number | undefined;
  /** Whether the failure is considered transient and safe to retry. */
  readonly retryable: boolean;
  /** 1-based attempt number, incremented by `route:failure` before classification. */
  readonly attempt: number;
  /** Pipeline phase that produced the failure. */
  readonly phase: 'fetch' | 'parse';
  /** Link text associated with the URL, if available from a crawl context. */
  readonly linkText: string | undefined;
};

/**
 * Decision returned by a failure policy's `classify` method.
 *
 * The discriminant field `route` drives which output port `route:failure` emits.
 *
 * @category Resilience
 * @since 3.2.0
 */
export type FailureRouteType =
  | { readonly route: 'retry' }
  | { readonly route: 'resolve'; readonly strategies: readonly string[] }
  | { readonly route: 'capture' }
  | { readonly route: 'expected'; readonly reason: string };
