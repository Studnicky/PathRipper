import { BaseError } from './BaseError.js';
import type { HttpErrorOptionsInterface } from '../types/HttpError.js';

export type { HttpErrorOptionsInterface };

/** Thrown on non-OK HTTP responses; automatically sets `retryable` for 5xx and 429 status codes. */
export class HttpError extends BaseError {
  /** HTTP response status code, if available. */
  public readonly status: number | undefined;
  /** Request URL that produced the error, if available. */
  public readonly url:    string | undefined;

  /**
   * @param message - Human-readable error description.
   * @param options - Optional status, url, cause, and metadata.
   */
  private constructor(message: string, options: HttpErrorOptionsInterface = {}) {
    const status = options.status;
    const retryable = status === undefined ? true : status >= 500 || status === 429;
    super(message, { retryable, ...options });
    this.status = status;
    this.url    = options.url;
  }

  /**
   * Creates an HttpError instance.
   *
   * @param message - Human-readable error description.
   * @param options - Optional status, url, cause, and metadata.
   * @returns A new HttpError.
   */
  public static create(message: string, options: HttpErrorOptionsInterface = {}): HttpError {
    return new HttpError(message, options);
  }
}
