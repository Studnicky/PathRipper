import { BaseError } from './BaseError.js';
import type { BaseErrorOptionsType } from './BaseError.js';

/**
 * Thrown when an external plugin or task file cannot be loaded or its schema is invalid.
 *
 * @remarks
 * Uses error code `EXTERNAL_SCHEMA`. Always non-retryable because the failure is structural.
 * Thrown by {@link TaskRegistry} when a plugin path resolves to a missing or unimportable module.
 *
 * @example
 * ```ts
 * throw ExternalSchemaError.create('Plugin not found: ./my-plugin.js', { metadata: { path } });
 * ```
 *
 * @category Errors
 * @since 2.0.0
 * @see {@link BaseError}
 * @group Core
 */
export class ExternalSchemaError extends BaseError {
  /**
   * @param message - Human-readable description of the schema or load failure.
   * @param options - Optional cause and metadata.
   */
  private constructor(message: string, options: BaseErrorOptionsType = {}) {
    super(message, { code: 'EXTERNAL_SCHEMA', retryable: false, ...options });
  }

  /**
   * Creates an ExternalSchemaError instance.
   *
   * @param message - Human-readable description of the failure.
   * @param options - Optional cause and metadata.
   * @returns A new ExternalSchemaError.
   */
  public static create(message: string, options: BaseErrorOptionsType = {}): ExternalSchemaError {
    return new ExternalSchemaError(message, options);
  }
}
