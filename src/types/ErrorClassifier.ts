import type { ErrorCategoryType } from './Http.js';

/** Result returned by `ErrorClassifier.classify()`. */
export interface ClassificationResultInterface {
  /** The category assigned to this error. */
  readonly category: ErrorCategoryType;
  /** Whether the failed operation may be retried. */
  readonly retryable: boolean;
  /** Suggested delay in milliseconds before the next retry, if available. */
  readonly backoffHint?: number | undefined;
}

/** Extension of `Error` that may carry HTTP status codes and headers. */
export interface ExtendedErrorInterface extends Error {
  /** Node.js error code (e.g. `ECONNREFUSED`). */
  readonly code?: string | undefined;
  /** HTTP response status code. */
  readonly status?: number | undefined;
  /** Alternative HTTP status code property used by some libraries. */
  readonly statusCode?: number | undefined;
  /** Response headers, used to read `Retry-After`. */
  readonly headers?: Readonly<Record<string, string | number | undefined>> | undefined;
}
