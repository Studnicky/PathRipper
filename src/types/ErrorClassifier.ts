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
 * @remarks Carries the assigned category, retry eligibility, and an optional backoff hint.
 * @example
 * ```ts
 * const result: ClassificationResultInterface = classifier.classify(error);
 * if (result.retryable) setTimeout(retry, result.backoffHint ?? 1000);
 * ```
 * @category Http
 * @since 2.0.0
 * @group Http
 * @see ErrorClassifier
 */
export interface ClassificationResultInterface {
  /** The category assigned to this error. */
  readonly category: ErrorCategoryType;
  /** Whether the failed operation may be retried. */
  readonly retryable: boolean;
  /** Suggested delay in milliseconds before the next retry, if available. */
  readonly backoffHint?: number | undefined;
}

/**
 * Extension of `Error` that may carry HTTP status codes and headers.
 *
 * @remarks Augments the standard `Error` with HTTP-specific fields used by the classifier.
 * @example
 * ```ts
 * const e: ExtendedErrorInterface = Object.assign(new Error('fail'), { status: 429 });
 * ```
 * @category Http
 * @since 2.0.0
 * @group Http
 * @see ErrorClassifier
 */
export interface ExtendedErrorInterface extends Error {
  /** Node.js error code (e.g. `ECONNREFUSED`). */
  readonly code?: string | undefined;
  /** HTTP response status code. */
  readonly status?: number | undefined;
  /** Alternative HTTP status code property used by some libraries. */
  readonly statusCode?: number | undefined;
  /** Response headers, used to read `Retry-After`. */
  readonly headers?: Readonly<Record<string, string | number | undefined>> | undefined;
}

/**
 * Rule entry used internally by `ErrorClassifier` to match and classify errors.
 *
 * @remarks Register rules via `ErrorClassifier.addRule` or pass an array to `ErrorClassifier.default`.
 * @example
 * ```ts
 * const rule: ClassificationRuleInterface = {
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
export interface ClassificationRuleInterface {
  readonly predicate: (error: ExtendedErrorInterface) => boolean;
  readonly category: ErrorCategoryType;
  readonly retryable?: boolean | undefined;
  readonly backoffHint?: number | ((error: ExtendedErrorInterface) => number) | undefined;
}

/**
 * Optional overrides accepted by `ErrorClassifier.addRule`.
 *
 * @remarks Subset of `ClassificationRuleInterface` properties that may be customised per rule.
 * @example
 * ```ts
 * const opts: ClassificationRuleOptionsType = { retryable: true, backoffHint: 2000 };
 * classifier.addRule(pred, ErrorCategory.NETWORK, opts);
 * ```
 * @category Http
 * @since 2.0.0
 * @group Http
 * @see ClassificationRuleInterface
 */
export type ClassificationRuleOptionsType = Partial<Pick<ClassificationRuleInterface, 'backoffHint' | 'retryable'>>;
