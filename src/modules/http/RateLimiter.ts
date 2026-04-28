import Bottleneck from 'bottleneck';

export interface RateLimiterConfigInterface {
  readonly minTimeMs: number;         // minimum ms between requests
  readonly jitterMs?: number | undefined;        // ±jitter applied per request (random in [0, jitterMs])
  readonly maxConcurrent?: number | undefined;
  readonly reservoir?: number | undefined;        // token bucket capacity
  readonly reservoirRefreshAmount?: number | undefined;
  readonly reservoirRefreshIntervalMs?: number | undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class RateLimiter {
  readonly #limiter: Bottleneck;
  readonly #jitterMs: number;

  constructor(config: RateLimiterConfigInterface) {
    this.#limiter = new Bottleneck({
      minTime:                    config.minTimeMs,
      maxConcurrent:              config.maxConcurrent ?? 1,
      ...(config.reservoir !== undefined                    && { reservoir:                config.reservoir }),
      ...(config.reservoirRefreshAmount !== undefined       && { reservoirRefreshAmount:   config.reservoirRefreshAmount }),
      ...(config.reservoirRefreshIntervalMs !== undefined   && { reservoirRefreshInterval: config.reservoirRefreshIntervalMs }),
    });
    this.#jitterMs = Math.max(0, config.jitterMs ?? 0);
  }

  schedule<T>(fn: () => Promise<T>): Promise<T> {
    if (this.#jitterMs === 0) return this.#limiter.schedule(fn);
    const jitter = this.#jitterMs;
    return this.#limiter.schedule(async () => {
      await sleep(Math.floor(Math.random() * jitter));
      return fn();
    });
  }

  async stop(): Promise<void> {
    await this.#limiter.stop({ dropWaitingJobs: false });
  }

  static perSecond(requestsPerSecond: number, jitterMs = 0): RateLimiter {
    return new RateLimiter({ minTimeMs: Math.ceil(1_000 / requestsPerSecond), jitterMs });
  }

  static withDelay(minDelayMs: number, jitterMs = 0): RateLimiter {
    return new RateLimiter({ minTimeMs: minDelayMs, jitterMs });
  }
}
