/** Configuration for RateLimiter instances backed by Bottleneck. */
export interface RateLimiterConfigInterface {
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
}
