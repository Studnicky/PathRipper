/** Configuration for RetryExecutor exponential-backoff behavior. */
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

/** Internal options used by `RetryExecutor.computeDelay`. */
export interface DelayOptsInterface {
  /** Base delay in milliseconds. */
  readonly base: number;
  /** Backoff multiplier. */
  readonly mult: number;
  /** Maximum delay cap in milliseconds. */
  readonly max:  number;
}
