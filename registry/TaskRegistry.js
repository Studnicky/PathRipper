import { resolve as resolvePath } from 'node:path';
import { ExternalSchemaError } from '../errors/ExternalSchemaError.js';
import { Logger } from '../modules/logger/Logger.js';
const logger = Logger.forComponent('TaskRegistry');
export class TaskRegistry {
    static #tasks = new Map();
    constructor() { }
    static register(name, task) {
        if (TaskRegistry.#tasks.has(name)) {
            logger.warn('register', `Overwriting existing task: ${name}`, { name });
        }
        TaskRegistry.#tasks.set(name, task);
    }
    static get(name) {
        return TaskRegistry.#tasks.get(name);
    }
    static has(name) {
        return TaskRegistry.#tasks.has(name);
    }
    static async load(pluginPath, baseDir = process.cwd()) {
        const absPath = resolvePath(baseDir, pluginPath);
        try {
            await import(absPath);
        }
        catch (err) {
            const nodeErr = err;
            if (nodeErr.code === 'ENOENT' || nodeErr.code === 'MODULE_NOT_FOUND' || nodeErr.code === 'ERR_MODULE_NOT_FOUND') {
                throw new ExternalSchemaError(`Plugin file not found: ${absPath}`, { cause: nodeErr instanceof Error ? nodeErr : undefined, metadata: { pluginPath, absPath } });
            }
            throw err;
        }
    }
    static async loadAll(paths, baseDir) {
        for (const p of paths) {
            await TaskRegistry.load(p, baseDir);
        }
    }
    static reset() {
        TaskRegistry.#tasks.clear();
    }
}
