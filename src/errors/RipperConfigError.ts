import { BaseError } from './BaseError.js';
import type { BaseErrorOptionsInterface } from './BaseError.js';

/**
 * Thrown when the ripperoni config file fails validation or cannot be loaded.
 *
 * @remarks
 * Uses error code `RIPPER_CONFIG`. Always non-retryable because config failures are structural.
 * Thrown by {@link RipperConfig} when the config JSON is missing, unparseable, or fails AJV validation.
 *
 * @example
 * ```ts
 * throw RipperConfigError.create('Invalid config at ./ripperoni.config.json', { metadata: { configPath } });
 * ```
 *
 * @category Configuration
 * @since 2.0.0
 * @see {@link RipperConfig}
 * @group Core
 */
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
  public static create(message: string, options: BaseErrorOptionsInterface = {}): RipperConfigError {
    return new RipperConfigError(message, options);
  }
}
