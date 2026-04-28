/** Construction options for BaseError and its subclasses. */
export interface BaseErrorOptionsInterface {
  /** Optional override for the auto-derived error code. */
  readonly code?:      string | undefined;
  /** Underlying error that caused this one. */
  readonly cause?:     Error | undefined;
  /** Arbitrary structured metadata attached to the error. */
  readonly metadata?:  Readonly<Record<string, unknown>> | undefined;
  /** Whether the operation that produced this error can be retried. */
  readonly retryable?: boolean | undefined;
}

/** JSON-serializable shape produced by `BaseError.toJson()`. */
export type BaseErrorJsonType = Readonly<{
  readonly code:      string;
  readonly message:   string;
  readonly name:      string;
  readonly retryable: boolean;
  readonly stack?:    string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly cause?:    BaseErrorJsonType | { readonly message: string; readonly name: string; readonly stack?: string };
}>;
