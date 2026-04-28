// Ported from @torreya/logger pattern — stripped of Torreya-specific concerns.

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type LevelType = keyof typeof LEVELS;

function currentLevel(): LevelType {
  const env = process.env['LOG_LEVEL']?.toLowerCase();
  if (env === 'debug' || env === 'info' || env === 'warn' || env === 'error') return env;
  return 'info';
}

function write(level: LevelType, component: string, operation: string, message: string, context?: Readonly<Record<string, unknown>>): void {
  if (LEVELS[level] < LEVELS[currentLevel()]) return;

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

export class Logger {
  readonly #component: string;

  private constructor(component: string) {
    this.#component = component;
  }

  static forComponent(component: string): Logger {
    return new Logger(component);
  }

  debug(operation: string, message: string, context?: Readonly<Record<string, unknown>>): void {
    write('debug', this.#component, operation, message, context);
  }

  info(operation: string, message: string, context?: Readonly<Record<string, unknown>>): void {
    write('info', this.#component, operation, message, context);
  }

  warn(operation: string, message: string, context?: Readonly<Record<string, unknown>>): void {
    write('warn', this.#component, operation, message, context);
  }

  error(operation: string, message: string, context?: Readonly<Record<string, unknown>>): void {
    write('error', this.#component, operation, message, context);
  }
}
