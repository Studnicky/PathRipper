import type { LevelType, WriteOptsInterface } from '../../types/Logger.js';


const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;

/** Structured JSON logger scoped to a named component. */
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

  /**
   * Logs a debug-level message.
   *
   * @param operation - Name of the method or operation emitting the log.
   * @param message - Human-readable log message.
   * @param context - Optional structured context data.
   */
  public debug(operation: string, message: string, context?: Readonly<Record<string, unknown>>): void {
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
    Logger.write({ level: 'error', component: this.#component, operation, message, context });
  }

  private static currentLevel(): LevelType {
    const env = process.env['LOG_LEVEL']?.toLowerCase();
    if (env === 'debug' || env === 'info' || env === 'warn' || env === 'error') return env;
    return 'info';
  }

  private static write(opts: WriteOptsInterface): void {
    if (LEVELS[opts.level] < LEVELS[Logger.currentLevel()]) return;

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
