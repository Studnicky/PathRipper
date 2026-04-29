import { BaseError } from './BaseError.js';
import type { BaseErrorOptionsInterface } from './BaseError.js';

/** Thrown when an external plugin or task file cannot be loaded or its schema is invalid. */
export class ExternalSchemaError extends BaseError {
  /**
   * @param message - Human-readable description of the schema or load failure.
   * @param options - Optional cause and metadata.
   */
  private constructor(message: string, options: BaseErrorOptionsInterface = {}) {
    super(message, { code: 'EXTERNAL_SCHEMA', retryable: false, ...options });
  }

  /**
   * Creates an ExternalSchemaError instance.
   *
   * @param message - Human-readable description of the failure.
   * @param options - Optional cause and metadata.
   * @returns A new ExternalSchemaError.
   */
  public static create(message: string, options: BaseErrorOptionsInterface = {}): ExternalSchemaError {
    return new ExternalSchemaError(message, options);
  }
}
