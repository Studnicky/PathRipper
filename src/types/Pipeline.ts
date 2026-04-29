/** Advances the pipeline to the next task in the queue. */
export interface NextFnInterface {
  (): Promise<void>;
}

/**
 * A single pipeline middleware function.
 *
 * @param next - Advances to the next task in the queue.
 * @param state - Mutable pipeline state shared across all tasks.
 */
export interface TaskFnInterface<TState> {
  (next: NextFnInterface, state: TState): Promise<void>;
}

/** Construction options for Pipeline instances. */
export interface PipelineConfigInterface {
  /** Optional name used for logging; defaults to `"Pipeline"`. */
  readonly name?: string | undefined;
}
