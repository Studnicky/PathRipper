import { BaseError } from './BaseError.js';
import type { BaseErrorOptionsInterface } from './BaseError.js';

export class ExternalSchemaError extends BaseError {
  public constructor(message: string, options: BaseErrorOptionsInterface = {}) {
    super(message, { retryable: false, ...options });
  }
}
