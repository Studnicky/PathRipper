import Bottleneck from 'bottleneck';
import { Time } from '../../utils/time.js';

export interface RateLimiterConfigInterface {
  readonly minTimeMs: number;
  readonly jitterMs?: number | undefined;
  readonly maxConcurrent?: number | undefined;
  readonly reservoir?: number | undefined;
  readonly reservoirRefreshAmount?: number | undefined;
  readonly reservoirRefreshIntervalMs?: number | undefined;
}

export class RateLimiter {
  readonly #limiter: Bottleneck;
  readonly #jitterMs: number;

  public constructor(config: RateLimiterConfigInterface) {
    this.#limiter = new Bottleneck({
      minTime:                    config.minTimeMs,
      maxConcurrent:              config.maxConcurrent ?? 1,
      ...(config.reservoir !== undefined                    && { reservoir:                config.reservoir }),
      ...(config.reservoirRefreshAmount !== undefined       && { reservoirRefreshAmount:   config.reservoirRefreshAmount }),
      ...(config.reservoirRefreshIntervalMs !== undefined   && { reservoirRefreshInterval: config.reservoirRefreshIntervalMs }),
    });
    this.#jitterMs = Math.max(0, config.jitterMs ?? 0);
  }

  public schedule<T>(fn: () => Promise<T>): Promise<T> {
    if (this.#jitterMs === 0) return this.#limiter.schedule(fn);
    const jitter = this.#jitterMs;
    return this.#limiter.schedule(async () => {
      await Time.sleep(Math.floor(Math.random() * jitter));
      return fn();
    });
  }

  public async stop(): Promise<void> {
    await this.#limiter.stop({ dropWaitingJobs: false });
  }

  public static perSecond(requestsPerSecond: number, jitterMs: number = 0): RateLimiter {
    return new RateLimiter({ minTimeMs: Math.ceil(1_000 / requestsPerSecond), jitterMs });
  }

  public static withDelay(minDelayMs: number, jitterMs: number = 0): RateLimiter {
    return new RateLimiter({ minTimeMs: minDelayMs, jitterMs });
  }
}
