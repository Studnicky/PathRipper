import Bottleneck from 'bottleneck';
import { Time } from '../time/Time.js';
export class RateLimiter {
    #limiter;
    #jitterMs;
    constructor(config) {
        this.#limiter = new Bottleneck({
            minTime: config.minTimeMs,
            maxConcurrent: config.maxConcurrent ?? 1,
            ...(config.reservoir !== undefined && { reservoir: config.reservoir }),
            ...(config.reservoirRefreshAmount !== undefined && { reservoirRefreshAmount: config.reservoirRefreshAmount }),
            ...(config.reservoirRefreshIntervalMs !== undefined && { reservoirRefreshInterval: config.reservoirRefreshIntervalMs }),
        });
        this.#jitterMs = Math.max(0, config.jitterMs ?? 0);
    }
    schedule(fn) {
        if (this.#jitterMs === 0)
            return this.#limiter.schedule(fn);
        const jitter = this.#jitterMs;
        return this.#limiter.schedule(async () => {
            await Time.sleep(Math.floor(Math.random() * jitter));
            return fn();
        });
    }
    async stop() {
        await this.#limiter.stop({ dropWaitingJobs: false });
    }
    static perSecond(requestsPerSecond, jitterMs = 0) {
        return new RateLimiter({ minTimeMs: Math.ceil(1_000 / requestsPerSecond), jitterMs });
    }
    static withDelay(minDelayMs, jitterMs = 0) {
        return new RateLimiter({ minTimeMs: minDelayMs, jitterMs });
    }
}
