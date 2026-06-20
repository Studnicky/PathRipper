import type { BaseErrorOptionsType } from './BaseError.js';

/**
 * Construction options for `HttpError`, extending `BaseErrorOptionsType` with HTTP context.
 *
 * @remarks
 * `status` should be the HTTP response status code (e.g. `404`, `503`).
 * `url` is the request URL that triggered the error and is included in the
 * serialised JSON produced by `BaseError.toJson()`.
 *
 * @example
 * ```ts
 * const opts: HttpErrorOptionsType = {
 *   status: 404,
 *   url: 'https://example.com/missing',
 *   retryable: false,
 * };
 * throw new HttpError('Page not found', opts);
 * ```
 *
 * @category Errors
 * @since 2.0.0
 * @see {@link BaseErrorOptionsType}
 * @group Types
 */
export type HttpErrorOptionsType = BaseErrorOptionsType & {
  /** HTTP response status code. */
  readonly status?: number | undefined;
  /** Request URL that produced the error. */
  readonly url?:    string | undefined;
};
