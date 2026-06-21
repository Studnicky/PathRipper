/**
 * Options bag for constructing a `BaseError` or any subclass.
 *
 * @remarks
 * All fields are optional; omitting `code` causes `BaseError` to derive one
 * from the subclass name automatically.
 *
 * @example
 * ```ts
 * const opts: BaseErrorOptionsType = {
 *   code: 'SCRAPE_FAILED',
 *   cause: originalError,
 *   metadata: { url: 'https://example.com' },
 *   retryable: true,
 * };
 * ```
 *
 * @category Errors
 * @since 2.0.0
 * @see {@link BaseErrorJsonType}
 * @group Types
 */
export type BaseErrorOptionsType = {
  /** Optional override for the auto-derived error code. */
  readonly code?:      string | undefined;
  /** Underlying error that caused this one. */
  readonly cause?:     Error | undefined;
  /** Arbitrary structured metadata attached to the error. */
  readonly metadata?:  Readonly<Record<string, unknown>> | undefined;
  /** Whether the operation that produced this error can be retried. */
  readonly retryable?: boolean | undefined;
};

/**
 * JSON-serializable shape produced by `BaseError.toJson()`.
 *
 * @remarks
 * Nested `cause` chains are represented recursively as either a full
 * `BaseErrorJsonType` (when the cause is itself a `BaseError`) or a minimal
 * `{ message, name, stack }` object for plain `Error` instances.
 *
 * @example
 * ```ts
 * const json: BaseErrorJsonType = error.toJson();
 * console.log(json.code, json.retryable);
 * ```
 *
 * @category Errors
 * @since 2.0.0
 * @see {@link BaseErrorOptionsType}
 * @group Types
 */
export type BaseErrorJsonType = Readonly<{
  readonly code:      string;
  readonly message:   string;
  readonly name:      string;
  readonly retryable: boolean;
  readonly stack?:    string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly cause?:    BaseErrorJsonType | { readonly message: string; readonly name: string; readonly stack?: string };
}>;
