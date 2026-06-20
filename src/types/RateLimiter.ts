/**
 * Configuration for `RateLimiter` instances backed by Bottleneck.
 *
 * @remarks
 * `minTimeMs` is the only required field.  `jitterMs` adds random variance to
 * avoid thundering-herd effects.  The reservoir fields enable token-bucket
 * burst control on top of the base rate limit.
 *
 * @example
 * ```ts
 * const config: RateLimiterConfigType = {
 *   minTimeMs: 500,
 *   jitterMs: 100,
 *   maxConcurrent: 2,
 *   reservoir: 10,
 *   reservoirRefreshAmount: 10,
 *   reservoirRefreshIntervalMs: 60_000,
 * };
 * ```
 *
 * @category Http
 * @since 2.0.0
 * @see {@link RateLimiterConfigType}
 * @group Types
 */
export type RateLimiterConfigType = {
  /** Minimum milliseconds between scheduled calls. */
  readonly minTimeMs: number;
  /** Maximum random jitter added to each delay, in milliseconds. */
  readonly jitterMs?: number | undefined;
  /** Maximum number of concurrent jobs (default 1). */
  readonly maxConcurrent?: number | undefined;
  /** Initial token reservoir count for burst limiting. */
  readonly reservoir?: number | undefined;
  /** Number of tokens added on each reservoir refresh. */
  readonly reservoirRefreshAmount?: number | undefined;
  /** Interval in milliseconds between reservoir refreshes. */
  readonly reservoirRefreshIntervalMs?: number | undefined;
};
