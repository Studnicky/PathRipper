// Modernized from PathRipper/src/transformer/index.js
// Transforms the callback-based task queue into typed async middleware.

import type { NextFnInterface, TaskFnInterface, PipelineConfigInterface } from '../types/Pipeline.js';
import { Logger } from '../modules/logger/logger.js';

export { type NextFnInterface, type TaskFnInterface, type PipelineConfigInterface };

/**
 * Ordered async middleware queue that passes shared state through each task in sequence.
 *
 * @remarks
 * Tasks are called in insertion order; each task receives a `next` function it must call
 * to advance the queue. Shared `state` is mutable across tasks.
 *
 * @example
 * ```ts
 * const pipeline = Pipeline.create<MyState>({ name: 'scrape' });
 * pipeline.addTasks([taskA, taskB]);
 * const result = await pipeline.execute({ url: 'https://example.com' });
 * ```
 *
 * @category Pipeline
 * @since 2.0.0
 * @see {@link TaskFnInterface}
 * @group Core
 */
export class Pipeline<TState extends Record<string, unknown>> {
  readonly #name: string;
  readonly #queue: TaskFnInterface<TState>[] = [];
  readonly #log: Logger;

  /**
   * @param config - Optional pipeline name used for logging.
   */
  private constructor(config: PipelineConfigInterface = {}) {
    this.#name = config.name ?? 'Pipeline';
    this.#log  = Logger.forComponent(this.#name);
  }

  /**
   * Creates a Pipeline instance.
   *
   * @param config - Optional pipeline name configuration.
   * @returns A new Pipeline instance.
   */
  public static create<TState extends Record<string, unknown>>(config: PipelineConfigInterface = {}): Pipeline<TState> {
    return new Pipeline<TState>(config);
  }

  /**
   * Appends a single task to the pipeline queue.
   *
   * @param task - Task function to add.
   * @returns `this` for fluent chaining.
   */
  addTask(task: TaskFnInterface<TState>): this {
    this.#queue.push(task);
    return this;
  }

  /**
   * Appends multiple tasks to the pipeline queue in order.
   *
   * @param tasks - Array of task functions to add.
   * @returns `this` for fluent chaining.
   */
  addTasks(tasks: ReadonlyArray<TaskFnInterface<TState>>): this {
    for (const task of tasks) this.addTask(task);
    return this;
  }

  /**
   * Runs all queued tasks in order, passing shared state through each one.
   *
   * @param state - Initial state object mutated and returned by the pipeline.
   * @returns The same `state` object after all tasks have run.
   */
  async execute(state: TState): Promise<TState> {
    this.#log.debug('execute', `Running ${this.#queue.length.toString()} tasks`);

    const run = async (index: number): Promise<void> => {
      const task = this.#queue[index];
      if (task === undefined) return;
      await task((): Promise<void> => run(index + 1), state);
    };

    await run(0);
    return state;
  }
}
