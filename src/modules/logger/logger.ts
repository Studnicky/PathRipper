const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type LevelType = keyof typeof LEVELS;

interface WriteOptsInterface {
  readonly level:     LevelType;
  readonly component: string;
  readonly operation: string;
  readonly message:   string;
  readonly context?:  Readonly<Record<string, unknown>> | undefined;
}

export class Logger {
  readonly #component: string;

  private constructor(component: string) {
    this.#component = component;
  }

  public static forComponent(component: string): Logger {
    return new Logger(component);
  }

  public debug(operation: string, message: string, context?: Readonly<Record<string, unknown>>): void {
    Logger.write({ level: 'debug', component: this.#component, operation, message, context });
  }

  public info(operation: string, message: string, context?: Readonly<Record<string, unknown>>): void {
    Logger.write({ level: 'info', component: this.#component, operation, message, context });
  }

  public warn(operation: string, message: string, context?: Readonly<Record<string, unknown>>): void {
    Logger.write({ level: 'warn', component: this.#component, operation, message, context });
  }

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
