/**
 * Supported log severity levels in ascending order of verbosity.
 *
 * @remarks
 * Levels follow the conventional syslog ordering.  Only entries at or above
 * the configured minimum level are emitted.
 *
 * @example
 * ```ts
 * const level: LevelType = 'warn';
 * logger.write({ level, component: 'Scraper', operation: 'fetch', message: 'Slow response' });
 * ```
 *
 * @category Logging
 * @since 2.0.0
 * @see {@link WriteOptsType}
 * @group Types
 */
export type LevelType = 'debug' | 'info' | 'warn' | 'error';

/**
 * Options passed to the internal `Logger.write` method for a single log entry.
 *
 * @remarks
 * `component` and `operation` must be different values; together they form the
 * structured context that identifies the source of the log entry.
 *
 * @example
 * ```ts
 * const opts: WriteOptsType = {
 *   level: 'info',
 *   component: 'HtmlScraper',
 *   operation: 'fetchPage',
 *   message: 'Fetched page successfully',
 *   context: { url: 'https://example.com/page' },
 * };
 * ```
 *
 * @category Logging
 * @since 2.0.0
 * @see {@link LevelType}
 * @group Types
 */
export type WriteOptsType = {
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
};
