import { BaseError } from './BaseError.js';
import type { BaseErrorOptionsInterface } from './BaseError.js';

type CreateResult = RipperConfigError;

/** Thrown when the ripperoni config file fails validation or cannot be loaded. */
export class RipperConfigError extends BaseError {
  /**
   * @param message - Human-readable description of the config failure.
   * @param options - Optional cause and metadata.
   */
  private constructor(message: string, options: BaseErrorOptionsInterface = {}) {
    super(message, { code: 'RIPPER_CONFIG', retryable: false, ...options });
  }

  /**
   * Creates a RipperConfigError instance.
   *
   * @param message - Human-readable description of the failure.
   * @param options - Optional cause and metadata.
   * @returns A new RipperConfigError.
   */
  public static create(message: string, options: BaseErrorOptionsInterface = {}): CreateResult {
    return new RipperConfigError(message, options);
  }
}
