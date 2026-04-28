import type { BaseErrorOptionsInterface } from './BaseError.js';

/** Construction options for HttpError, extending BaseErrorOptionsInterface with HTTP context. */
export interface HttpErrorOptionsInterface extends BaseErrorOptionsInterface {
  /** HTTP response status code. */
  readonly status?: number | undefined;
  /** Request URL that produced the error. */
  readonly url?:    string | undefined;
}
