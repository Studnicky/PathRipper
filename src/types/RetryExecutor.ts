/**
 * Configuration for `RetryExecutor` exponential-backoff behavior.
 *
 * @remarks
 * All fields are optional; defaults are `maxAttempts: 3`, `baseDelayMs: 500`,
 * `multiplier: 2`, and `maxDelayMs: 30_000`.  Setting `maxAttempts: 1`
 * disables retries entirely.
 *
 * @example
 * ```ts
 * const config: RetryConfigInterface = {
 *   maxAttempts: 5,
 *   baseDelayMs: 250,
 *   multiplier: 2,
 *   maxDelayMs: 10_000,
 * };
 * ```
 *
 * @category Http
 * @since 2.0.0
 * @see {@link DelayOptsInterface}
 * @group Types
 */
export interface RetryConfigInterface {
  /** Maximum number of attempts before giving up (default 3). */
  readonly maxAttempts?: number | undefined;
  /** Initial delay in milliseconds before the first retry (default 500). */
  readonly baseDelayMs?: number | undefined;
  /** Backoff multiplier applied to each successive delay (default 2). */
  readonly multiplier?:  number | undefined;
  /** Maximum delay cap in milliseconds (default 30 000). */
  readonly maxDelayMs?:  number | undefined;
}

/**
 * Internal options used by `RetryExecutor.computeDelay` to calculate backoff.
 *
 * @remarks
 * This interface is an internal implementation detail of `RetryExecutor`; it
 * is exported only so that subclasses or tests can reference the shape without
 * reconstructing it from `RetryConfigInterface`.
 *
 * @example
 * ```ts
 * const opts: DelayOptsInterface = { base: 500, mult: 2, max: 30_000 };
 * const delay = RetryExecutor.computeDelay(attempt, opts);
 * ```
 *
 * @category Http
 * @since 2.0.0
 * @see {@link RetryConfigInterface}
 * @group Types
 */
export interface DelayOptsInterface {
  /** Base delay in milliseconds. */
  readonly base: number;
  /** Backoff multiplier. */
  readonly mult: number;
  /** Maximum delay cap in milliseconds. */
  readonly max:  number;
}
