import { RetryPolicy } from '@studnicky/dagonizer/runtime';
import { BackoffStrategyNames } from '@studnicky/dagonizer/entities';
import type { RetryPolicyOptionsType } from '@studnicky/dagonizer/runtime';
import { ErrorClassifier } from './errorClassifier.js';
import type { ExtendedErrorInterface } from './errorClassifier.js';

export type { RetryPolicyOptionsType };

const DEFAULT_MAX_ATTEMPTS  = 3;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS  = 30_000;

/**
 * Configuration for `HttpRetryPolicy`.
 *
 * @remarks
 * Maps Ripperoni's flat retry config shape to `RetryPolicy` options.
 * All fields are optional; defaults are `maxAttempts: 3`, `baseDelayMs: 500`,
 * `maxDelayMs: 30_000`. Setting `maxAttempts: 1` disables retries entirely.
 *
 * @category Http
 * @since 3.0.0
 * @group Types
 */
export interface HttpRetryConfigInterface {
  /** Maximum number of attempts before giving up (default 3). */
  readonly maxAttempts?:    number | undefined;
  /** Initial delay in milliseconds before the first retry (default 500). */
  readonly baseDelayMs?:    number | undefined;
  /** Maximum delay cap in milliseconds (default 30 000). */
  readonly maxDelayMs?:     number | undefined;
}

/**
 * `RetryPolicy` subclass that uses `ErrorClassifier` for retry decisions.
 *
 * @remarks
 * Overrides `shouldRetry` to consult `ErrorClassifier.classify()` instead of
 * `instanceof` checks — necessary because Ripperoni's HTTP errors are not
 * segregated into distinct Error subclasses per category.
 *
 * Overrides `getDelay` to honor `backoffHint` from `Retry-After` headers on
 * HTTP 429 responses. For all other categories, DECORRELATED_JITTER backoff is
 * used (same effective curve as the v2.x bespoke retry loop).
 *
 * Delay waits run through `Scheduler.current()` — install `VirtualScheduler`
 * in tests to advance virtual time deterministically.
 *
 * @example
 * ```ts
 * const policy = HttpRetryPolicy.create({ maxAttempts: 3, baseDelayMs: 500 });
 * const html = await policy.run(() => fetch(url).then(r => r.text()));
 * ```
 *
 * @category Http
 * @since 3.0.0
 * @see {@link ErrorClassifier}
 * @group Core
 */
export class HttpRetryPolicy extends RetryPolicy {
  readonly #classifier: ErrorClassifier;

  /**
   * @param config - Retry configuration; merged over Ripperoni defaults.
   */
  private constructor(config: HttpRetryConfigInterface = {}) {
    super({
      maxAttempts: config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      strategy:    BackoffStrategyNames.DECORRELATED_JITTER,
      baseDelay:   config.baseDelayMs ?? DEFAULT_BASE_DELAY_MS,
      maxDelay:    config.maxDelayMs  ?? DEFAULT_MAX_DELAY_MS,
      retryOn:     [],
      abortOn:     [],
    });
    this.#classifier = ErrorClassifier.default();
  }

  /**
   * Creates an `HttpRetryPolicy` instance.
   *
   * @param config - Optional retry configuration.
   * @returns A new `HttpRetryPolicy`.
   */
  public static create(config: HttpRetryConfigInterface = {}): HttpRetryPolicy {
    return new HttpRetryPolicy(config);
  }

  /**
   * Delegates retry decisions to `ErrorClassifier.classify()`.
   *
   * @param error - Error to evaluate.
   * @param attempt - Current attempt number (1-based).
   * @returns Whether the error should be retried.
   */
  public override shouldRetry(error: Error, attempt: number): boolean {
    if (attempt >= this.maxAttempts) return false;
    const result = this.#classifier.classify(error as ExtendedErrorInterface);
    return result.retryable;
  }

  /**
   * Honors the `backoffHint` from `Retry-After` headers on HTTP 429 responses.
   * Falls back to the base `DECORRELATED_JITTER` computation for all other categories.
   *
   * @param attempt - Current attempt number (1-based).
   * @param error - Error that triggered the retry.
   * @returns Delay in milliseconds before the next attempt.
   */
  public override getDelay(attempt: number, options?: { readonly error: Error | null }): number {
    const error = options?.error ?? null;
    if (error !== null) {
      const result = this.#classifier.classify(error as ExtendedErrorInterface);
      if (result.backoffHint !== undefined) return Math.min(result.backoffHint, this.maxDelay);
    }
    return super.getDelay(attempt, { error });
  }
}
