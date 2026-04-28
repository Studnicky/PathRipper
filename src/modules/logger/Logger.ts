const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type LevelType = keyof typeof LEVELS;

export class Logger {
  readonly #component: string;

  private constructor(component: string) {
    this.#component = component;
  }

  public static forComponent(component: string): Logger {
    return new Logger(component);
  }

  public debug(operation: string, message: string, context?: Readonly<Record<string, unknown>>): void {
    Logger.write('debug', this.#component, operation, message, context);
  }

  public info(operation: string, message: string, context?: Readonly<Record<string, unknown>>): void {
    Logger.write('info', this.#component, operation, message, context);
  }

  public warn(operation: string, message: string, context?: Readonly<Record<string, unknown>>): void {
    Logger.write('warn', this.#component, operation, message, context);
  }

  public error(operation: string, message: string, context?: Readonly<Record<string, unknown>>): void {
    Logger.write('error', this.#component, operation, message, context);
  }

  private static currentLevel(): LevelType {
    const env = process.env['LOG_LEVEL']?.toLowerCase();
    if (env === 'debug' || env === 'info' || env === 'warn' || env === 'error') return env;
    return 'info';
  }

  private static write(
    level: LevelType,
    component: string,
    operation: string,
    message: string,
    context?: Readonly<Record<string, unknown>>,
  ): void {
    if (LEVELS[level] < LEVELS[Logger.currentLevel()]) return;

    const entry: Record<string, unknown> = {
      time: new Date().toISOString(),
      level,
      component,
      operation,
      message,
    };
    if (context !== undefined) entry['context'] = context;

    const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
    stream.write(JSON.stringify(entry) + '\n');
  }
}
