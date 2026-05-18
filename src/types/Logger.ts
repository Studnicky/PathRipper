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
 * @see {@link WriteOptsInterface}
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
 * const opts: WriteOptsInterface = {
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

/**
 * Component-scoped logger surface — the per-instance shape returned by
 * `LoggerFactoryInterface.forComponent`.
 *
 * @remarks
 * Mirrors the public surface of `src/modules/logger/logger.ts` `Logger` so
 * lifecycle plugins, classifier plugins, and any other consumer of
 * `ctx.logger.forComponent('Foo')` can declare a typed dependency without
 * importing the concrete class.
 *
 * @category Logging
 * @since 0.7.0
 * @see {@link LoggerFactoryInterface}
 * @group Types
 */
export interface ComponentLoggerInterface {
  /** Logs a debug-level message. */
  debug(operation: string, message: string, context?: Readonly<Record<string, unknown>>): void;
  /** Logs an info-level message. */
  info(operation: string, message: string, context?: Readonly<Record<string, unknown>>): void;
  /** Logs a warn-level message. */
  warn(operation: string, message: string, context?: Readonly<Record<string, unknown>>): void;
  /** Logs an error-level message. */
  error(operation: string, message: string, context?: Readonly<Record<string, unknown>>): void;
}

/**
 * Logger factory the run-wide context exposes via `ctx.logger`.
 *
 * @remarks
 * Populated by the `context:logger` lifecycle plugin during `onRunStart`. Every
 * downstream plugin obtains a component-scoped logger via
 * `ctx.logger.forComponent('MyPlugin')`. The concrete `Logger` class in
 * `src/modules/logger/logger.ts` already satisfies this shape via its static
 * `forComponent` method.
 *
 * @example
 * ```ts
 * const log = ctx.logger.forComponent('MyClassifier');
 * log.info('onRunStart', 'classifier ready');
 * ```
 *
 * @category Logging
 * @since 0.7.0
 * @see {@link ComponentLoggerInterface}
 * @group Types
 */
export interface LoggerFactoryInterface {
  /**
   * Returns a logger scoped to the given component name.
   *
   * @param component - Name of the module or class (e.g. `"SchemaClassifier"`).
   */
  forComponent(component: string): ComponentLoggerInterface;
}
