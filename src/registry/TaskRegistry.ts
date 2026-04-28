import { resolve } from 'node:path';

import type { TaskFnType } from '../types/pipeline.js';
import { ExternalSchemaError } from '../errors/ExternalSchemaError.js';
import { Logger } from '../modules/logger/logger.js';
import type { PipelineStateInterface } from './PipelineState.js';

const logger = Logger.forComponent('TaskRegistry');

export class TaskRegistry {
  static readonly #tasks = new Map<string, TaskFnType<PipelineStateInterface>>();

  private constructor() { /* static-only */ }

  public static register(name: string, task: TaskFnType<PipelineStateInterface>): void {
    if (TaskRegistry.#tasks.has(name)) {
      logger.warn('register', `Overwriting existing task: ${name}`, { name });
    }
    TaskRegistry.#tasks.set(name, task);
  }

  public static get(name: string): TaskFnType<PipelineStateInterface> {
    const task = TaskRegistry.#tasks.get(name);
    if (task === undefined) {
      throw new ExternalSchemaError(`Task not found: ${name}`, { metadata: { name } });
    }
    return task;
  }

  public static has(name: string): boolean {
    return TaskRegistry.#tasks.has(name);
  }

  public static async load(pluginPath: string, baseDir: string = process.cwd()): Promise<void> {
    const absPath = resolve(baseDir, pluginPath);
    try {
      await import(absPath);
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code === 'ENOENT' || nodeErr.code === 'MODULE_NOT_FOUND' || nodeErr.code === 'ERR_MODULE_NOT_FOUND') {
        throw new ExternalSchemaError(
          `Plugin file not found: ${absPath}`,
          { cause: nodeErr instanceof Error ? nodeErr : undefined, metadata: { pluginPath, absPath } },
        );
      }
      throw err;
    }
  }

  public static async loadAll(paths: string[], baseDir?: string): Promise<void> {
    for (const p of paths) {
      await TaskRegistry.load(p, baseDir);
    }
  }

  public static reset(): void {
    const count = TaskRegistry.#tasks.size;
    TaskRegistry.#tasks.clear();
    logger.debug('reset', `Cleared ${count.toString()} registered tasks`, { count });
  }
}
