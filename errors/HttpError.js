import { BaseError } from './BaseError.js';
export class HttpError extends BaseError {
    status;
    url;
    constructor(message, options = {}) {
        const status = options.status;
        const retryable = status === undefined ? true : status >= 500 || status === 429;
        super(message, { retryable, ...options });
        this.status = status;
        this.url = options.url;
    }
}
