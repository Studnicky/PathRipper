import Bottleneck from 'bottleneck';

export interface RateLimiterConfigInterface {
  readonly minTimeMs: number;         // minimum ms between requests
  readonly maxConcurrent?: number | undefined;
  readonly reservoir?: number | undefined;        // token bucket capacity
  readonly reservoirRefreshAmount?: number | undefined;
  readonly reservoirRefreshIntervalMs?: number | undefined;
}

export class RateLimiter {
  readonly #limiter: Bottleneck;

  constructor(config: RateLimiterConfigInterface) {
    this.#limiter = new Bottleneck({
      minTime:                    config.minTimeMs,
      maxConcurrent:              config.maxConcurrent ?? 1,
      ...(config.reservoir !== undefined                    && { reservoir:                config.reservoir }),
      ...(config.reservoirRefreshAmount !== undefined       && { reservoirRefreshAmount:   config.reservoirRefreshAmount }),
      ...(config.reservoirRefreshIntervalMs !== undefined   && { reservoirRefreshInterval: config.reservoirRefreshIntervalMs }),
    });
  }

  schedule<T>(fn: () => Promise<T>): Promise<T> {
    return this.#limiter.schedule(fn);
  }

  async stop(): Promise<void> {
    await this.#limiter.stop({ dropWaitingJobs: false });
  }

  static perSecond(requestsPerSecond: number): RateLimiter {
    return new RateLimiter({ minTimeMs: Math.ceil(1_000 / requestsPerSecond) });
  }

  static withDelay(minDelayMs: number): RateLimiter {
    return new RateLimiter({ minTimeMs: minDelayMs });
  }
}
