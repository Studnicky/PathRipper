/**
 * Callable that advances the pipeline to the next queued task.
 *
 * @remarks
 * A `TaskFnInterface` receives this as its first argument.  Calling it resumes
 * the downstream chain; not calling it short-circuits the remaining tasks.
 *
 * @example
 * ```ts
 * const task: TaskFnInterface<MyState> = async (next, state) => {
 *   state.output = { processed: true };
 *   await next(); // continue to next task
 * };
 * ```
 *
 * @category Pipeline
 * @since 2.0.0
 * @see {@link TaskFnInterface}
 * @group Types
 */
export interface NextFnInterface {
  (): Promise<void>;
}

/**
 * A single middleware step executed by `Pipeline`.
 *
 * @typeParam TState - The pipeline state type shared across all tasks.
 *
 * @remarks
 * Tasks receive a mutable `state` reference and the `next` function.  Awaiting
 * `next()` passes control downstream; returning without calling it halts the
 * chain.
 *
 * @example
 * ```ts
 * const parseTask: TaskFnInterface<PipelineStateInterface> = async (next, state) => {
 *   state.output = { title: state.page.title };
 *   await next();
 * };
 * ```
 *
 * @category Pipeline
 * @since 2.0.0
 * @see {@link NextFnInterface}
 * @group Types
 */
export interface TaskFnInterface<TState> {
  (next: NextFnInterface, state: TState): Promise<void>;
}

/**
 * Construction options for `Pipeline` instances.
 *
 * @remarks
 * Currently only `name` is configurable; it is used as a log prefix to
 * distinguish concurrent pipeline instances in output.
 *
 * @example
 * ```ts
 * const config: PipelineConfigInterface = { name: 'WikiPipeline' };
 * const pipeline = new Pipeline(config);
 * ```
 *
 * @category Pipeline
 * @since 2.0.0
 * @see {@link TaskFnInterface}
 * @group Types
 */
export interface PipelineConfigInterface {
  /** Optional name used for logging; defaults to `"Pipeline"`. */
  readonly name?: string | undefined;
}
