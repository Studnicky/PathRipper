import type { PipelineConfigInterface } from '../types/Pipeline.js';
import type { Pipeline } from './Pipeline.js';
import { Logger } from '../modules/logger/logger.js';

export type { PipelineConfigInterface };

/**
 * Result of a {@link ConcurrentPipeline.executeAll} run.
 *
 * @typeParam TState - The pipeline state type.
 * @category Pipeline
 * @since 2.0.0
 * @group Core
 */
export interface ConcurrentResultInterface<TState> {
  /** States that completed without error. */
  readonly completed: TState[];
  /** States that threw, paired with the thrown error. */
  readonly failed: Array<{ state: TState; error: unknown }>;
}

class Semaphore {
  #slots: number;
  readonly #waiting: Array<() => void> = [];

  constructor(slots: number) { this.#slots = slots; }

  async acquire(): Promise<void> {
    if (this.#slots > 0) { this.#slots--; return; }
    await new Promise<void>((resolve): void => { this.#waiting.push(resolve); });
  }

  release(): void {
    const next = this.#waiting.shift();
    if (next !== undefined) { next(); } else { this.#slots++; }
  }
}

/**
 * Bounded-concurrency batch executor built on a shared `Pipeline` instance.
 *
 * @remarks
 * Fans out a list of states across a single `Pipeline` with a semaphore capping
 * how many executions run at once. The underlying `Pipeline` is safe to share —
 * its task queue is read-only during execution and each `execute()` call has its
 * own closure state.
 *
 * Set `concurrency: 1` for sequential behaviour identical to calling
 * `pipeline.execute()` in a loop; larger values introduce true parallelism.
 *
 * All concurrent executions share whatever scraper and cache are wired into each
 * state's `context` — the caller is responsible for passing a shared cache
 * instance so HTTP responses are deduplicated across concurrent pages.
 *
 * @example
 * ```ts
 * const pipeline = Pipeline.create<PipelineStateInterface>({ name: 'wiki' });
 * pipeline.addTasks([parseTask, writeTask]);
 *
 * const runner = ConcurrentPipeline.create(pipeline, 8, { name: 'wiki' });
 * const { completed, failed } = await runner.executeAll(states);
 * ```
 *
 * @category Pipeline
 * @since 2.0.0
 * @group Core
 */
export class ConcurrentPipeline<TState extends Record<string, unknown>> {
  readonly #pipeline:    Pipeline<TState>;
  readonly #concurrency: number;
  readonly #log:         Logger;

  private constructor(pipeline: Pipeline<TState>, concurrency: number, name: string) {
    this.#pipeline    = pipeline;
    this.#concurrency = Math.max(1, concurrency);
    this.#log         = Logger.forComponent(name);
  }

  /**
   * Creates a `ConcurrentPipeline` wrapping an already-configured `Pipeline`.
   *
   * @param pipeline    - Shared pipeline whose task queue is applied to every state.
   * @param concurrency - Maximum number of pipeline executions to run in parallel.
   * @param config      - Optional name for log output.
   */
  public static create<TState extends Record<string, unknown>>(
    pipeline:    Pipeline<TState>,
    concurrency: number,
    config:      PipelineConfigInterface = {},
  ): ConcurrentPipeline<TState> {
    return new ConcurrentPipeline<TState>(pipeline, concurrency, config.name ?? 'ConcurrentPipeline');
  }

  /**
   * Executes `pipeline` for every state in `states`, running at most
   * `concurrency` executions simultaneously.
   *
   * @param states - Mutable state objects to process; each is passed to
   *                 `pipeline.execute()` independently.
   * @returns `completed` states (execution succeeded) and `failed` pairs
   *          (execution threw, error preserved).
   */
  public async executeAll(states: ReadonlyArray<TState>): Promise<ConcurrentResultInterface<TState>> {
    const completed: TState[]                                  = [];
    const failed:    Array<{ state: TState; error: unknown }> = [];
    const sem = new Semaphore(this.#concurrency);

    this.#log.debug('executeAll',
      `${states.length.toString()} states · concurrency=${this.#concurrency.toString()}`);

    await Promise.all(
      states.map(async (state: TState): Promise<void> => {
        await sem.acquire();
        try {
          await this.#pipeline.execute(state);
          completed.push(state);
        } catch (err) {
          failed.push({ state, error: err });
        } finally {
          sem.release();
        }
      }),
    );

    return { completed, failed };
  }
}
