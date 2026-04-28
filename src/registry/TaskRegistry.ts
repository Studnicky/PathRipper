import { resolve } from 'node:path';

import type { TaskFnType } from '../types/Pipeline.js';
import { ExternalSchemaError } from '../errors/ExternalSchemaError.js';
import { Logger } from '../modules/logger/logger.js';
import type { PipelineStateInterface } from '../types/PipelineState.js';

const logger = Logger.forComponent('TaskRegistry');

/** Global registry mapping task names to pipeline task functions. */
export class TaskRegistry {
  /** Registered task name to TaskFnType map. */
  static readonly #tasks = new Map<string, TaskFnType<PipelineStateInterface>>();

  private constructor() { /* static-only */ }

  /**
   * Registers a named task, overwriting any existing task with the same name.
   *
   * @param name - Unique task name (conventionally `"target:operation"`).
   * @param task - Task function to register.
   */
  public static register(name: string, task: TaskFnType<PipelineStateInterface>): void {
    if (TaskRegistry.#tasks.has(name)) {
      logger.warn('register', `Overwriting existing task: ${name}`, { name });
    }
    TaskRegistry.#tasks.set(name, task);
  }

  /**
   * Retrieves a registered task by name.
   *
   * @param name - Task name to look up.
   * @returns The registered task function.
   * @throws {ExternalSchemaError} When no task is registered under `name`.
   */
  public static get(name: string): TaskFnType<PipelineStateInterface> {
    const task = TaskRegistry.#tasks.get(name);
    if (task === undefined) {
      throw ExternalSchemaError.create(`Task not found: ${name}`, { metadata: { name } });
    }
    return task;
  }

  /**
   * Returns `true` if a task with the given name is registered.
   *
   * @param name - Task name to check.
   * @returns Whether a task is registered under `name`.
   */
  public static has(name: string): boolean {
    return TaskRegistry.#tasks.has(name);
  }

  /**
   * Dynamically imports a plugin file to self-register its tasks.
   *
   * @param pluginPath - Path to the plugin module, resolved relative to `baseDir`.
   * @param baseDir - Base directory for resolving `pluginPath` (default `process.cwd()`).
   * @throws {ExternalSchemaError} When the plugin file cannot be found or imported.
   */
  public static async load(pluginPath: string, baseDir: string = process.cwd()): Promise<void> {
    const absPath = resolve(baseDir, pluginPath);
    try {
      await import(absPath);
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code === 'ENOENT' || nodeErr.code === 'MODULE_NOT_FOUND' || nodeErr.code === 'ERR_MODULE_NOT_FOUND') {
        throw ExternalSchemaError.create(
          `Plugin file not found: ${absPath}`,
          { cause: nodeErr instanceof Error ? nodeErr : undefined, metadata: { pluginPath, absPath } },
        );
      }
      throw err;
    }
  }

  /**
   * Loads multiple plugin files in sequence.
   *
   * @param paths - Array of plugin paths to load.
   * @param baseDir - Base directory for resolving paths.
   * @throws {ExternalSchemaError} When any plugin file cannot be found or imported.
   */
  public static async loadAll(paths: string[], baseDir?: string): Promise<void> {
    for (const p of paths) {
      await TaskRegistry.load(p, baseDir);
    }
  }

  /** Clears all registered tasks; intended for use in tests. */
  public static reset(): void {
    const count = TaskRegistry.#tasks.size;
    TaskRegistry.#tasks.clear();
    logger.debug('reset', `Cleared ${count.toString()} registered tasks`, { count });
  }
}
