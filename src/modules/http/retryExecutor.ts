import type { ExtendedErrorInterface } from './errorClassifier.js';
import { ErrorClassifier } from './errorClassifier.js';
import { Time } from '../../utils/time.js';

export interface RetryConfigInterface {
  readonly maxAttempts?: number | undefined;
  readonly baseDelayMs?: number | undefined;
  readonly multiplier?:  number | undefined;
  readonly maxDelayMs?:  number | undefined;
}

interface DelayOptsInterface {
  readonly base: number;
  readonly mult: number;
  readonly max:  number;
}

const MAX_ATTEMPTS_DEFAULT  = 3;
const BASE_DELAY_MS_DEFAULT = 500;
const MULTIPLIER_DEFAULT    = 2;
const MAX_DELAY_MS_DEFAULT  = 30_000;

const DEFAULTS = {
  maxAttempts: MAX_ATTEMPTS_DEFAULT,
  baseDelayMs: BASE_DELAY_MS_DEFAULT,
  multiplier:  MULTIPLIER_DEFAULT,
  maxDelayMs:  MAX_DELAY_MS_DEFAULT,
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
          : RetryExecutor.computeDelay(attempt, { base: this.#base, mult: this.#mult, max: this.#maxDelay });

        await Time.sleep(wait);
      }
    }
  }

  private static computeDelay(attempt: number, opts: DelayOptsInterface): number {
    const jitter = Math.random() * 0.2 - 0.1; // ±10% decorrelated jitter
    const raw = opts.base * opts.mult ** (attempt - 1) * (1 + jitter);
    return Math.min(Math.round(raw), opts.max);
  }
}
