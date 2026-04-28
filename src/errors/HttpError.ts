import { BaseError } from './BaseError.js';
import type { BaseErrorOptionsInterface } from './BaseError.js';

export interface HttpErrorOptionsInterface extends BaseErrorOptionsInterface {
  readonly status?: number | undefined;
  readonly url?:    string | undefined;
}

export class HttpError extends BaseError {
  public readonly status: number | undefined;
  public readonly url:    string | undefined;

  public constructor(message: string, options: HttpErrorOptionsInterface = {}) {
    const status = options.status;
    const retryable = status === undefined ? true : status >= 500 || status === 429;
    super(message, { retryable, ...options });
    this.status = status;
    this.url    = options.url;
  }
}
