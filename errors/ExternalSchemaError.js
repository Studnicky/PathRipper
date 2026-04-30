import { BaseError } from './BaseError.js';
export class ExternalSchemaError extends BaseError {
    constructor(message, options = {}) {
        super(message, { retryable: false, ...options });
    }
}
