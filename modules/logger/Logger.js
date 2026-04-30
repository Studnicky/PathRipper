const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
export class Logger {
    #component;
    constructor(component) {
        this.#component = component;
    }
    static forComponent(component) {
        return new Logger(component);
    }
    debug(operation, message, context) {
        Logger.write('debug', this.#component, operation, message, context);
    }
    info(operation, message, context) {
        Logger.write('info', this.#component, operation, message, context);
    }
    warn(operation, message, context) {
        Logger.write('warn', this.#component, operation, message, context);
    }
    error(operation, message, context) {
        Logger.write('error', this.#component, operation, message, context);
    }
    static currentLevel() {
        const env = process.env['LOG_LEVEL']?.toLowerCase();
        if (env === 'debug' || env === 'info' || env === 'warn' || env === 'error')
            return env;
        return 'info';
    }
    static write(level, component, operation, message, context) {
        if (LEVELS[level] < LEVELS[Logger.currentLevel()])
            return;
        const entry = {
            time: new Date().toISOString(),
            level,
            component,
            operation,
            message,
        };
        if (context !== undefined)
            entry['context'] = context;
        const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
        stream.write(JSON.stringify(entry) + '\n');
    }
}
