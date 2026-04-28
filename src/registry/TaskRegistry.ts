import { resolve as resolvePath } from 'node:path';

import type { TaskFnType } from '../pipeline/Pipeline.js';
import { MappingError } from '../errors/MappingError.js';
import { ExternalSchemaError } from '../errors/ExternalSchemaError.js';
import type { PipelineStateInterface } from './PipelineState.js';

export class TaskRegistry {
  static readonly #tasks = new Map<string, TaskFnType<PipelineStateInterface>>();

  private constructor() { /* static-only */ }

  public static register(name: string, task: TaskFnType<PipelineStateInterface>): void {
    if (TaskRegistry.#tasks.has(name)) {
      throw new MappingError(`Task already registered: ${name}`, { metadata: { name } });
    }
    TaskRegistry.#tasks.set(name, task);
  }

  public static get(name: string): TaskFnType<PipelineStateInterface> | undefined {
    return TaskRegistry.#tasks.get(name);
  }

  public static has(name: string): boolean {
    return TaskRegistry.#tasks.has(name);
  }

  public static async load(pluginPath: string, baseDir: string = process.cwd()): Promise<void> {
    const absPath = resolvePath(baseDir, pluginPath);
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
    TaskRegistry.#tasks.clear();
  }
}
