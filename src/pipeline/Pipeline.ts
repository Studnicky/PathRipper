// Modernized from PathRipper/src/transformer/index.js
// Transforms the callback-based task queue into typed async middleware.

import type { NextFnType, TaskFnType } from '../types/pipeline.js';
import { Logger } from '../modules/logger/logger.js';

export { type NextFnType, type TaskFnType };

export interface PipelineConfigInterface {
  readonly name?: string | undefined;
}

export class Pipeline<TState extends Record<string, unknown>> {
  readonly #name: string;
  readonly #queue: TaskFnType<TState>[] = [];
  readonly #log: Logger;

  constructor(config: PipelineConfigInterface = {}) {
    this.#name = config.name ?? 'Pipeline';
    this.#log  = Logger.forComponent(this.#name);
  }

  addTask(task: TaskFnType<TState>): this {
    this.#queue.push(task);
    return this;
  }

  addTasks(tasks: ReadonlyArray<TaskFnType<TState>>): this {
    for (const task of tasks) this.addTask(task);
    return this;
  }

  async execute(state: TState): Promise<TState> {
    this.#log.debug('execute', `Running ${this.#queue.length.toString()} tasks`);

    const run = async (index: number): Promise<void> => {
      const task = this.#queue[index];
      if (task === undefined) return;
      await task(() => run(index + 1), state);
    };

    await run(0);
    return state;
  }
}
