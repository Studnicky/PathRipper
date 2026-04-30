import type { LevelType, WriteOptsInterface } from '../../types/Logger.js';


const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;

/**
 * Structured JSON logger scoped to a named component.
 *
 * @remarks
 * Writes newline-delimited JSON to `stdout` (debug/info) and `stderr` (warn/error).
 * Active log level is controlled via the `LOG_LEVEL` environment variable (`debug|info|warn|error`).
 * Defaults to `info` when the variable is absent or unrecognised.
 *
 * @example
 * ```ts
 * const log = Logger.forComponent('HtmlScraper');
 * log.info('fetchPage', 'Fetching page', { url });
 * ```
 *
 * @category Logging
 * @since 2.0.0
 * @see {@link LevelType}
 * @group Core
 */
export class Logger {
  readonly #component: string;

  /**
   * @param component - Name of the module or class that owns this logger.
   */
  private constructor(component: string) {
    this.#component = component;
  }

  /**
   * Creates a Logger scoped to the given component name.
   *
   * @param component - Name of the module or class (e.g. `"HtmlScraper"`).
   * @returns A new Logger instance.
   */
  public static forComponent(component: string): Logger {
    return new Logger(component);
  }

  private static currentLevel(): LevelType {
    const env = process.env['LOG_LEVEL']?.toLowerCase();
    if (env === 'debug' || env === 'info' || env === 'warn' || env === 'error') return env;
    return 'info';
  }

  /**
   * Logs a debug-level message.
   *
   * @param operation - Name of the method or operation emitting the log.
   * @param message - Human-readable log message.
   * @param context - Optional structured context data.
   */
  public debug(operation: string, message: string, context?: Readonly<Record<string, unknown>>): void {
    if (LEVELS['debug'] < LEVELS[Logger.currentLevel()]) return;
    Logger.write({ level: 'debug', component: this.#component, operation, message, context });
  }

  /**
   * Logs an info-level message.
   *
   * @param operation - Name of the method or operation emitting the log.
   * @param message - Human-readable log message.
   * @param context - Optional structured context data.
   */
  public info(operation: string, message: string, context?: Readonly<Record<string, unknown>>): void {
    if (LEVELS['info'] < LEVELS[Logger.currentLevel()]) return;
    Logger.write({ level: 'info', component: this.#component, operation, message, context });
  }

  /**
   * Logs a warn-level message.
   *
   * @param operation - Name of the method or operation emitting the log.
   * @param message - Human-readable log message.
   * @param context - Optional structured context data.
   */
  public warn(operation: string, message: string, context?: Readonly<Record<string, unknown>>): void {
    if (LEVELS['warn'] < LEVELS[Logger.currentLevel()]) return;
    Logger.write({ level: 'warn', component: this.#component, operation, message, context });
  }

  /**
   * Logs an error-level message.
   *
   * @param operation - Name of the method or operation emitting the log.
   * @param message - Human-readable log message.
   * @param context - Optional structured context data.
   */
  public error(operation: string, message: string, context?: Readonly<Record<string, unknown>>): void {
    if (LEVELS['error'] < LEVELS[Logger.currentLevel()]) return;
    Logger.write({ level: 'error', component: this.#component, operation, message, context });
  }

  private static write(opts: WriteOptsInterface): void {

    const entry: Record<string, unknown> = {
      time:      new Date().toISOString(),
      level:     opts.level,
      component: opts.component,
      operation: opts.operation,
      message:   opts.message,
    };
    if (opts.context !== undefined) entry['context'] = opts.context;

    const stream = opts.level === 'error' || opts.level === 'warn' ? process.stderr : process.stdout;
    stream.write(JSON.stringify(entry) + '\n');
  }
}
