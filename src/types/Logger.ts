/** Supported log severity levels in ascending order. */
export type LevelType = 'debug' | 'info' | 'warn' | 'error';

/** Options passed to the internal Logger.write method. */
export interface WriteOptsInterface {
  /** Severity level of the log entry. */
  readonly level:     LevelType;
  /** Name of the module or class emitting the log. */
  readonly component: string;
  /** Name of the method or operation emitting the log. */
  readonly operation: string;
  /** Human-readable log message. */
  readonly message:   string;
  /** Optional structured context data. */
  readonly context?:  Readonly<Record<string, unknown>> | undefined;
}
