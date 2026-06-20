import type { ErrorCategoryType } from './Http.js';

/**
 * Frozen map of error category string literals for use as classification keys.
 *
 * @remarks Use these constants when registering rules or comparing classification results.
 * @example
 * ```ts
 * classifier.addRule(pred, ErrorCategory.NETWORK, { retryable: true });
 * ```
 * @category Http
 * @since 2.0.0
 * @group Http
 * @see ErrorClassifier
 * @defaultValue `'unknown'` when no rule matches
 */
export const ErrorCategory = Object.freeze({
  NETWORK:    'network',
  PERMANENT:  'permanent',
  RESOURCE:   'resource',
  THROTTLED:  'throttled',
  TIMEOUT:    'timeout',
  TRANSIENT:  'transient',
  UNKNOWN:    'unknown',
  VALIDATION: 'validation',
} as const);

/**
 * Result returned by `ErrorClassifier.classify()`.
 *
 * @remarks
 * Carries the assigned category, retryability derived from the matched rule,
 * and an optional backoff hint (e.g. from a `Retry-After` header). Retry
 * decisions are consumed by `HttpRetryPolicy`; external callers should use
 * the category directly.
 *
 * @example
 * ```ts
 * const { category, backoffHint } = classifier.classify(error);
 * ```
 * @category Http
 * @since 2.0.0
 * @group Http
 * @see ErrorClassifier
 */
export type ClassificationResultType = {
  /** The category assigned to this error. */
  readonly category: ErrorCategoryType;
  /** Whether the failed operation may be retried (derived from the matched rule). */
  readonly retryable: boolean;
  /** Suggested delay in milliseconds before the next retry, if available. */
  readonly backoffHint?: number | undefined;
};

/**
 * Extension of `Error` that may carry HTTP status codes and headers.
 *
 * @remarks Augments the standard `Error` with HTTP-specific fields used by the classifier.
 * @example
 * ```ts
 * const e: ExtendedErrorType = Object.assign(new Error('fail'), { status: 429 });
 * ```
 * @category Http
 * @since 2.0.0
 * @group Http
 * @see ErrorClassifier
 */
export type ExtendedErrorType = Error & {
  /** Node.js error code (e.g. `ECONNREFUSED`). */
  readonly code?: string | undefined;
  /** HTTP response status code. */
  readonly status?: number | undefined;
  /** Alternative HTTP status code property used by some libraries. */
  readonly statusCode?: number | undefined;
  /** Response headers, used to read `Retry-After`. */
  readonly headers?: Readonly<Record<string, string | number | undefined>> | undefined;
};

/**
 * Rule entry used internally by `ErrorClassifier` to match and classify errors.
 *
 * @remarks Register rules via `ErrorClassifier.addRule` or pass an array to `ErrorClassifier.default`.
 * @example
 * ```ts
 * const rule: ClassificationRuleType = {
 *   predicate: (e) => e.code === 'ECONNREFUSED',
 *   category: ErrorCategory.NETWORK,
 *   retryable: true,
 * };
 * ```
 * @category Http
 * @since 2.0.0
 * @group Http
 * @see ErrorClassifier
 */
export type ClassificationRuleType = {
  readonly predicate: (error: ExtendedErrorType) => boolean;
  readonly category: ErrorCategoryType;
  readonly retryable?: boolean | undefined;
  readonly backoffHint?: number | ((error: ExtendedErrorType) => number) | undefined;
};

/**
 * Optional overrides accepted by `ErrorClassifier.addRule`.
 *
 * @remarks Subset of `ClassificationRuleType` properties that may be customised per rule.
 * @example
 * ```ts
 * const opts: ClassificationRuleOptionsType = { backoffHint: 2000 };
 * classifier.addRule(pred, ErrorCategory.NETWORK, opts);
 * ```
 * @category Http
 * @since 2.0.0
 * @group Http
 * @see ClassificationRuleType
 */
export type ClassificationRuleOptionsType = Partial<Pick<ClassificationRuleType, 'backoffHint' | 'retryable'>>;
