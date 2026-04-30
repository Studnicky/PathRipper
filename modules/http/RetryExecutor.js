import { ErrorClassifier } from './ErrorClassifier.js';
import { Time } from '../time/Time.js';
const DEFAULTS = {
    maxAttempts: 3,
    baseDelayMs: 500,
    multiplier: 2,
    maxDelayMs: 30_000,
};
export class RetryExecutor {
    #classifier;
    #max;
    #base;
    #mult;
    #maxDelay;
    constructor(config = {}) {
        this.#classifier = ErrorClassifier.default();
        this.#max = config.maxAttempts ?? DEFAULTS.maxAttempts;
        this.#base = config.baseDelayMs ?? DEFAULTS.baseDelayMs;
        this.#mult = config.multiplier ?? DEFAULTS.multiplier;
        this.#maxDelay = config.maxDelayMs ?? DEFAULTS.maxDelayMs;
    }
    async execute(fn) {
        let attempt = 0;
        for (;;) {
            attempt++;
            try {
                return await fn();
            }
            catch (err) {
                const result = this.#classifier.classify(err);
                if (!result.retryable || attempt >= this.#max)
                    throw err;
                const wait = result.backoffHint !== undefined
                    ? result.backoffHint
                    : RetryExecutor.computeDelay(attempt, this.#base, this.#mult, this.#maxDelay);
                await Time.sleep(wait);
            }
        }
    }
    static computeDelay(attempt, base, mult, max) {
        const jitter = Math.random() * 0.2 - 0.1; // ±10% decorrelated jitter
        const raw = base * mult ** (attempt - 1) * (1 + jitter);
        return Math.min(Math.round(raw), max);
    }
}
