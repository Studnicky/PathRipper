import type { BaseErrorOptionsInterface } from './BaseError.js';

/**
 * Construction options for `HttpError`, extending `BaseErrorOptionsInterface` with HTTP context.
 *
 * @remarks
 * `status` should be the HTTP response status code (e.g. `404`, `503`).
 * `url` is the request URL that triggered the error and is included in the
 * serialised JSON produced by `BaseError.toJson()`.
 *
 * @example
 * ```ts
 * const opts: HttpErrorOptionsInterface = {
 *   status: 404,
 *   url: 'https://example.com/missing',
 *   retryable: false,
 * };
 * throw new HttpError('Page not found', opts);
 * ```
 *
 * @category Errors
 * @since 2.0.0
 * @see {@link BaseErrorOptionsInterface}
 * @group Types
 */
export interface HttpErrorOptionsInterface extends BaseErrorOptionsInterface {
  /** HTTP response status code. */
  readonly status?: number | undefined;
  /** Request URL that produced the error. */
  readonly url?:    string | undefined;
}
