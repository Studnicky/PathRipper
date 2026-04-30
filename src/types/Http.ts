/**
 * Discriminated union of HTTP/network error categories used by `ErrorClassifier`.
 *
 * @remarks
 * Each literal maps to a distinct handling strategy: `'transient'` and
 * `'throttled'` are retryable, `'permanent'` and `'validation'` are not, and
 * `'unknown'` leaves the decision to the caller.
 *
 * @example
 * ```ts
 * const category: ErrorCategoryType = ErrorClassifier.default().classify(err).category;
 * if (category === 'throttled') await delay(retryAfterMs);
 * ```
 *
 * @category Http
 * @since 2.0.0
 * @see {@link ErrorCategoryType}
 * @group Types
 */
export type ErrorCategoryType =
  | 'network'
  | 'permanent'
  | 'resource'
  | 'throttled'
  | 'timeout'
  | 'transient'
  | 'unknown'
  | 'validation';
