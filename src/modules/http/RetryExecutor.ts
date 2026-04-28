import type { ExtendedErrorInterface } from './ErrorClassifier.js';
import { ErrorClassifier } from './ErrorClassifier.js';
import { Time } from '../time/Time.js';

export interface RetryConfigInterface {
  readonly maxAttempts?: number | undefined;
  readonly baseDelayMs?: number | undefined;
  readonly multiplier?:  number | undefined;
  readonly maxDelayMs?:  number | undefined;
}

const DEFAULTS = {
  maxAttempts: 3,
  baseDelayMs: 500,
  multiplier:  2,
  maxDelayMs:  30_000,
} as const;

export class RetryExecutor {
  readonly #classifier: ErrorClassifier;
  readonly #max: number;
  readonly #base: number;
  readonly #mult: number;
  readonly #maxDelay: number;

  public constructor(config: RetryConfigInterface = {}) {
    this.#classifier = ErrorClassifier.default();
    this.#max        = config.maxAttempts ?? DEFAULTS.maxAttempts;
    this.#base       = config.baseDelayMs ?? DEFAULTS.baseDelayMs;
    this.#mult       = config.multiplier  ?? DEFAULTS.multiplier;
    this.#maxDelay   = config.maxDelayMs  ?? DEFAULTS.maxDelayMs;
  }

  public async execute<T>(fn: () => Promise<T>): Promise<T> {
    let attempt = 0;

    for (;;) {
      attempt++;
      try {
        return await fn();
      } catch (err) {
        const result = this.#classifier.classify(err as ExtendedErrorInterface);

        if (!result.retryable || attempt >= this.#max) throw err;

        const wait = result.backoffHint !== undefined
          ? result.backoffHint
          : RetryExecutor.computeDelay(attempt, this.#base, this.#mult, this.#maxDelay);

        await Time.sleep(wait);
      }
    }
  }

  private static computeDelay(attempt: number, base: number, mult: number, max: number): number {
    const jitter = Math.random() * 0.2 - 0.1; // ±10% decorrelated jitter
    const raw = base * mult ** (attempt - 1) * (1 + jitter);
    return Math.min(Math.round(raw), max);
  }
}
