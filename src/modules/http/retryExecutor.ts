import type { ExecuteResult } from '../../types/Results.js';
import type { ExtendedErrorInterface } from './errorClassifier.js';
import { ErrorClassifier } from './errorClassifier.js';
import { Time } from '../time/time.js';
import type { RetryConfigInterface, DelayOptsInterface } from '../../types/RetryExecutor.js';

export type { RetryConfigInterface, DelayOptsInterface };

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

/** Retries async operations with exponential backoff based on ErrorClassifier decisions. */
export class RetryExecutor {
  readonly #classifier: ErrorClassifier;
  readonly #max: number;
  readonly #base: number;
  readonly #mult: number;
  readonly #maxDelay: number;

  /**
   * @param config - Retry configuration including max attempts, base delay, and multiplier.
   */
  private constructor(config: RetryConfigInterface = {}) {
    this.#classifier = ErrorClassifier.default();
    this.#max        = config.maxAttempts ?? DEFAULTS.maxAttempts;
    this.#base       = config.baseDelayMs ?? DEFAULTS.baseDelayMs;
    this.#mult       = config.multiplier  ?? DEFAULTS.multiplier;
    this.#maxDelay   = config.maxDelayMs  ?? DEFAULTS.maxDelayMs;
  }

  /**
   * Creates a RetryExecutor instance.
   *
   * @param config - Retry configuration.
   * @returns A new RetryExecutor.
   */
  public static create(config: RetryConfigInterface = {}): RetryExecutor {
    return new RetryExecutor(config);
  }

  /**
   * Executes `fn`, retrying on retryable errors with exponential backoff.
   *
   * @param fn - Async function to execute and potentially retry.
   * @returns Promise resolving with the function's return value on success.
   * @throws The last error if the maximum attempt count is reached or the error is not retryable.
   */
  public async execute<T>(fn: () => Promise<T>): ExecuteResult<T> {
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
