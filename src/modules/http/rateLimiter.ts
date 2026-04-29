import type { ScheduleResult } from '../../types/Results.js';
import Bottleneck from 'bottleneck';
import { Time } from '../time/time.js';
import type { RateLimiterConfigInterface } from '../../types/RateLimiter.js';

export type { RateLimiterConfigInterface };

/** Throttles concurrent and sequential async calls using Bottleneck with optional jitter. */
export class RateLimiter {
  readonly #limiter: Bottleneck;
  readonly #jitterMs: number;

  /**
   * @param config - Rate limiter configuration including minimum time and optional jitter.
   */
  private constructor(config: RateLimiterConfigInterface) {
    this.#limiter = new Bottleneck({
      minTime:                    config.minTimeMs,
      maxConcurrent:              config.maxConcurrent ?? 1,
      ...(config.reservoir !== undefined                    && { reservoir:                config.reservoir }),
      ...(config.reservoirRefreshAmount !== undefined       && { reservoirRefreshAmount:   config.reservoirRefreshAmount }),
      ...(config.reservoirRefreshIntervalMs !== undefined   && { reservoirRefreshInterval: config.reservoirRefreshIntervalMs }),
    });
    this.#jitterMs = Math.max(0, config.jitterMs ?? 0);
  }

  /**
   * Creates a RateLimiter instance.
   *
   * @param config - Rate limiter configuration.
   * @returns A new RateLimiter.
   */
  public static create(config: RateLimiterConfigInterface): RateLimiter {
    return new RateLimiter(config);
  }

  /**
   * Schedules an async function respecting the configured rate limit and jitter.
   *
   * @param fn - Async function to schedule.
   * @returns Promise that resolves with the function's return value.
   */
  public schedule<T>(fn: () => Promise<T>): ScheduleResult<T> {
    if (this.#jitterMs === 0) return this.#limiter.schedule(fn);
    const jitter = this.#jitterMs;
    return this.#limiter.schedule(async (): Promise<T> => {
      await Time.sleep(Math.floor(Math.random() * jitter));
      return fn();
    });
  }

  /**
   * Gracefully stops the underlying Bottleneck limiter, draining queued jobs.
   *
   * @returns Promise that resolves when the limiter has stopped.
   */
  public async stop(): Promise<void> {
    await this.#limiter.stop({ dropWaitingJobs: false });
  }

  /**
   * Creates a RateLimiter that allows at most `requestsPerSecond` calls per second.
   *
   * @param requestsPerSecond - Target throughput in requests per second.
   * @param jitterMs - Maximum random jitter added to each delay, in milliseconds.
   * @returns A new RateLimiter configured for the given throughput.
   */
  public static perSecond(requestsPerSecond: number, jitterMs: number = 0): RateLimiter {
    return new RateLimiter({ minTimeMs: Math.ceil(1_000 / requestsPerSecond), jitterMs });
  }

  /**
   * Creates a RateLimiter with a fixed minimum delay between calls.
   *
   * @param minDelayMs - Minimum milliseconds between calls.
   * @param jitterMs - Maximum random jitter added to each delay, in milliseconds.
   * @returns A new RateLimiter configured with the given delay.
   */
  public static withDelay(minDelayMs: number, jitterMs: number = 0): RateLimiter {
    return new RateLimiter({ minTimeMs: minDelayMs, jitterMs });
  }
}
