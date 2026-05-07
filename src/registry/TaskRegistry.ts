import { resolve } from 'node:path';

import type { TaskFnInterface } from '../types/Pipeline.js';
import { ExternalSchemaError } from '../errors/ExternalSchemaError.js';
import { Logger } from '../modules/logger/logger.js';
import type { PipelineContextInterface, PipelineStateInterface } from '../types/PipelineState.js';

const logger = Logger.forComponent('TaskRegistry');

/**
 * Lifecycle phase a task hook participates in.
 *
 * @remarks
 * - `onRunStart` — runs once per target run, before any per-record dispatch.
 *   Used by `src/context/*` lifecycle plugins to populate `ctx.logger`,
 *   `ctx.ajv`, `ctx.dataset`, `ctx.prefixes`, etc.
 * - `onRunEnd` — runs once per target run, after the per-record batch settles
 *   (after enrichment + finalize task drains).
 *
 * Per-record tasks omit `phase` (or set it to `undefined`) and register via
 * the standard `register(name, fn)` path.
 *
 * @category Registry
 * @since 0.7.0
 * @group Types
 */
export type LifecyclePhaseType = 'onRunStart' | 'onRunEnd';

/**
 * Function signature for a lifecycle hook (`onRunStart` / `onRunEnd`).
 *
 * @remarks
 * Hooks receive a mutable view of the run-wide context; the orchestrator passes
 * the in-progress context through every `onRunStart` hook in registration order
 * before the per-record pipeline executes. Hooks may both READ already-populated
 * silo keys (e.g. `ctx.logger` in any hook past `context:logger`) and WRITE
 * their own slot.
 *
 * @category Registry
 * @since 0.7.0
 * @see {@link TaskRegistry.registerHook}
 * @group Types
 */
export interface HookFnInterface {
  (ctx: PipelineContextInterface): Promise<void> | void;
}

/**
 * Registration manifest carrying optional metadata about a registered task or
 * lifecycle hook.
 *
 * @remarks
 * The orchestrator uses manifests to count `proposesClass: true` plugins for
 * the `classify:conflict`-required check. Lifecycle hooks set `phase` to
 * `'onRunStart'` or `'onRunEnd'`; per-record proposers leave `phase` undefined.
 *
 * @category Registry
 * @since 0.7.0
 * @group Types
 */
export interface TaskManifestInterface {
  /** Registered task or hook name (e.g. `"classify:rules"`, `"context:ajv"`). */
  readonly name:           string;
  /** Lifecycle phase; absent for per-record tasks. */
  readonly phase?:         LifecyclePhaseType | undefined;
  /**
   * `true` when this task contributes a class proposal to
   * `state.classifications`. The orchestrator counts these to enforce the
   * "≥2 proposers requires `classify:conflict`" rule.
   */
  readonly proposesClass?: boolean | undefined;
}

/**
 * Registry mapping task names to pipeline task functions.
 *
 * @remarks
 * Supports two usage modes:
 *
 * **Static (global default)** — The historical API. All static methods delegate
 * to a module-private singleton `defaultRegistry`. Plugins that call
 * `TaskRegistry.register('json:read', fn)` at import time continue to populate
 * this singleton without any changes.
 *
 * **Instance (per-run isolation)** — Construct a fresh `new TaskRegistry()` for
 * each pipeline run. The instance carries its own private task map; registrations
 * on it never affect the default registry or sibling instances. This enables
 * per-target classifiers (task C1 and later) to register target-specific tasks
 * without cross-contamination in concurrent runs.
 *
 * Tasks are registered by name and looked up by the pipeline runner at execution
 * time. Plugins self-register by calling {@link TaskRegistry.register} on import.
 *
 * Lifecycle hooks (`onRunStart` / `onRunEnd`) are registered separately via
 * {@link TaskRegistry.registerHook} and queried via
 * {@link TaskRegistry.onRunStartHooks} / {@link TaskRegistry.onRunEndHooks}.
 * Hooks live in their own ordered maps so per-record dispatch never sees them.
 *
 * @example Static usage (back-compat):
 * ```ts
 * TaskRegistry.register('monsters:transform', async (next, state) => { await next(); });
 * await TaskRegistry.load('./plugins/monsters.js');
 * ```
 *
 * @example Instance usage (per-run isolation):
 * ```ts
 * const registry = new TaskRegistry();
 * registry.register('classify:rules', classifyRulesTask);
 * const pipeline = new Pipeline({ name: 'my-run', registry });
 * ```
 *
 * @example Lifecycle hook registration:
 * ```ts
 * TaskRegistry.registerHook('context:ajv', 'onRunStart', async (ctx) => {
 *   (ctx as { ajv: Ajv }).ajv = new Ajv();
 * });
 * ```
 *
 * @category Registry
 * @since 2.0.0
 * @see {@link Pipeline}
 * @group Core
 */
export class TaskRegistry {
  // ---------------------------------------------------------------------------
  // Instance state
  // ---------------------------------------------------------------------------

  /** Per-instance task name → TaskFnInterface map. */
  readonly #tasks = new Map<string, TaskFnInterface<PipelineStateInterface>>();

  /** Per-instance manifest map keyed by task or hook name. Insertion-ordered. */
  readonly #manifests = new Map<string, TaskManifestInterface>();

  /** Per-instance `onRunStart` hook map keyed by hook name. Insertion-ordered. */
  readonly #onRunStart = new Map<string, HookFnInterface>();

  /** Per-instance `onRunEnd` hook map keyed by hook name. Insertion-ordered. */
  readonly #onRunEnd = new Map<string, HookFnInterface>();

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * Creates an empty, isolated `TaskRegistry` instance.
   *
   * @remarks
   * The instance has its own private task map. Registrations on it do not affect
   * the static default registry or any other instance.
   */
  public constructor() { /* intentionally empty — maps initialised above */ }

  // ---------------------------------------------------------------------------
  // Instance methods
  // ---------------------------------------------------------------------------

  /**
   * Registers a named per-record task on this instance, overwriting any
   * existing task with the same name.
   *
   * @param name     - Unique task name (conventionally `"target:operation"`).
   * @param task     - Task function to register.
   * @param manifest - Optional registration metadata (e.g. `proposesClass: true`).
   */
  public register(
    name:     string,
    task:     TaskFnInterface<PipelineStateInterface>,
    manifest?: Omit<TaskManifestInterface, 'name' | 'phase'>,
  ): void {
    if (this.#tasks.has(name)) {
      logger.warn('register', `Overwriting existing task: ${name}`, { name });
    }
    this.#tasks.set(name, task);
    this.#manifests.set(name, {
      name,
      ...(manifest?.proposesClass !== undefined ? { proposesClass: manifest.proposesClass } : {}),
    });
  }

  /**
   * Registers a lifecycle hook (`onRunStart` or `onRunEnd`) on this instance.
   *
   * @remarks
   * Hooks are kept in insertion order on a Map separate from the per-record
   * task map. The orchestrator runs `onRunStart` hooks once per target run
   * before per-record dispatch, and `onRunEnd` hooks once after the per-record
   * batch settles, in registration order. Re-registering a name overwrites
   * silently with a warn-level log.
   *
   * @param name     - Unique hook name (conventionally `"context:<key>"`).
   * @param phase    - `'onRunStart'` or `'onRunEnd'`.
   * @param fn       - Hook function `(ctx) => Promise<void> | void`.
   * @param manifest - Optional registration metadata.
   */
  public registerHook(
    name:     string,
    phase:    LifecyclePhaseType,
    fn:       HookFnInterface,
    manifest?: Omit<TaskManifestInterface, 'name' | 'phase'>,
  ): void {
    const bucket = phase === 'onRunStart' ? this.#onRunStart : this.#onRunEnd;
    if (bucket.has(name)) {
      logger.warn('registerHook', `Overwriting existing hook: ${name}`, { name, phase });
    }
    bucket.set(name, fn);
    this.#manifests.set(name, {
      name,
      phase,
      ...(manifest?.proposesClass !== undefined ? { proposesClass: manifest.proposesClass } : {}),
    });
  }

  /**
   * Retrieves a task by name from this instance.
   *
   * @param name - Task name to look up.
   * @returns The registered task function.
   * @throws {ExternalSchemaError} When no task is registered under `name`.
   */
  public get(name: string): TaskFnInterface<PipelineStateInterface> {
    const task = this.#tasks.get(name);
    if (task === undefined) {
      throw ExternalSchemaError.create(`Task not found: ${name}`, { metadata: { name } });
    }
    return task;
  }

  /**
   * Returns `true` if a task with the given name is registered on this instance.
   *
   * @param name - Task name to check.
   * @returns Whether a task is registered under `name`.
   */
  public has(name: string): boolean {
    const found = this.#tasks.has(name);
    logger.debug('has', `Task lookup: ${name}`, { name, found });
    return found;
  }

  /**
   * Returns the registered `onRunStart` hooks in registration (insertion) order.
   *
   * @returns Array of `[name, fn]` tuples.
   */
  public onRunStartHooks(): ReadonlyArray<readonly [string, HookFnInterface]> {
    return Array.from(this.#onRunStart.entries());
  }

  /**
   * Returns the registered `onRunEnd` hooks in registration (insertion) order.
   *
   * @returns Array of `[name, fn]` tuples.
   */
  public onRunEndHooks(): ReadonlyArray<readonly [string, HookFnInterface]> {
    return Array.from(this.#onRunEnd.entries());
  }

  /**
   * Returns the manifests of every registered task and hook on this instance,
   * in registration order.
   */
  public manifests(): ReadonlyArray<TaskManifestInterface> {
    return Array.from(this.#manifests.values());
  }

  /**
   * Clears all tasks, hooks, and manifests registered on this instance.
   *
   * @remarks
   * Intended for use in tests. Does not affect the static default registry.
   */
  public reset(): void {
    const taskCount  = this.#tasks.size;
    const hookCount  = this.#onRunStart.size + this.#onRunEnd.size;
    this.#tasks.clear();
    this.#onRunStart.clear();
    this.#onRunEnd.clear();
    this.#manifests.clear();
    logger.debug(
      'reset',
      `Cleared ${taskCount.toString()} tasks and ${hookCount.toString()} hooks`,
      { taskCount, hookCount },
    );
  }

  /**
   * Dynamically imports a plugin file to self-register its tasks.
   *
   * @remarks
   * The plugin's side-effect imports call `TaskRegistry.register(...)` (the
   * static surface), populating the default registry. To load a plugin into
   * this instance instead, call {@link TaskRegistry.register} explicitly after
   * import.
   *
   * @param pluginPath - Path to the plugin module, resolved relative to `baseDir`.
   * @param baseDir - Base directory for resolving `pluginPath` (default `process.cwd()`).
   * @throws {ExternalSchemaError} When the plugin file cannot be found or imported.
   */
  public async load(pluginPath: string, baseDir: string = process.cwd()): Promise<void> {
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
  public async loadAll(paths: ReadonlyArray<string>, baseDir?: string): Promise<void> {
    for (const p of paths) {
      await this.load(p, baseDir);
    }
  }

  // ---------------------------------------------------------------------------
  // Static surface — delegates to the module-private default registry
  // ---------------------------------------------------------------------------

  /**
   * Registers a named per-record task on the global default registry.
   *
   * @remarks
   * Back-compat wrapper — delegates to `defaultRegistry.register(...)`.
   * Plugins self-register by calling this at module load time.
   *
   * @param name     - Unique task name.
   * @param task     - Task function to register.
   * @param manifest - Optional registration metadata (e.g. `proposesClass: true`).
   */
  public static register(
    name:     string,
    task:     TaskFnInterface<PipelineStateInterface>,
    manifest?: Omit<TaskManifestInterface, 'name' | 'phase'>,
  ): void {
    defaultRegistry.register(name, task, manifest);
  }

  /**
   * Registers a lifecycle hook on the global default registry.
   *
   * @param name     - Unique hook name.
   * @param phase    - `'onRunStart'` or `'onRunEnd'`.
   * @param fn       - Hook function `(ctx) => Promise<void> | void`.
   * @param manifest - Optional registration metadata.
   */
  public static registerHook(
    name:     string,
    phase:    LifecyclePhaseType,
    fn:       HookFnInterface,
    manifest?: Omit<TaskManifestInterface, 'name' | 'phase'>,
  ): void {
    defaultRegistry.registerHook(name, phase, fn, manifest);
  }

  /**
   * Retrieves a task by name from the global default registry.
   *
   * @param name - Task name to look up.
   * @returns The registered task function.
   * @throws {ExternalSchemaError} When no task is registered under `name`.
   */
  public static get(name: string): TaskFnInterface<PipelineStateInterface> {
    return defaultRegistry.get(name);
  }

  /**
   * Returns `true` if a task with the given name is registered in the global default registry.
   *
   * @param name - Task name to check.
   * @returns Whether a task is registered under `name`.
   */
  public static has(name: string): boolean {
    return defaultRegistry.has(name);
  }

  /**
   * Returns the `onRunStart` hooks registered on the global default registry,
   * in registration order.
   */
  public static onRunStartHooks(): ReadonlyArray<readonly [string, HookFnInterface]> {
    return defaultRegistry.onRunStartHooks();
  }

  /**
   * Returns the `onRunEnd` hooks registered on the global default registry,
   * in registration order.
   */
  public static onRunEndHooks(): ReadonlyArray<readonly [string, HookFnInterface]> {
    return defaultRegistry.onRunEndHooks();
  }

  /**
   * Returns manifests of every registered task and hook on the global default
   * registry, in registration order.
   */
  public static manifests(): ReadonlyArray<TaskManifestInterface> {
    return defaultRegistry.manifests();
  }

  /**
   * Clears all tasks, hooks, and manifests registered in the global default
   * registry.
   *
   * @remarks
   * Intended for use in tests.
   */
  public static reset(): void {
    defaultRegistry.reset();
  }

  /**
   * Dynamically imports a plugin file to self-register its tasks into the
   * global default registry.
   *
   * @param pluginPath - Path to the plugin module, resolved relative to `baseDir`.
   * @param baseDir - Base directory for resolving `pluginPath` (default `process.cwd()`).
   * @throws {ExternalSchemaError} When the plugin file cannot be found or imported.
   */
  public static async load(pluginPath: string, baseDir?: string): Promise<void> {
    await defaultRegistry.load(pluginPath, baseDir);
  }

  /**
   * Loads multiple plugin files in sequence into the global default registry.
   *
   * @param paths - Array of plugin paths to load.
   * @param baseDir - Base directory for resolving paths.
   * @throws {ExternalSchemaError} When any plugin file cannot be found or imported.
   */
  public static async loadAll(paths: ReadonlyArray<string>, baseDir?: string): Promise<void> {
    await defaultRegistry.loadAll(paths, baseDir);
  }
}

// ---------------------------------------------------------------------------
// Module-private default registry (singleton)
// ---------------------------------------------------------------------------

/**
 * Module-private singleton that backs all static `TaskRegistry.*` calls.
 *
 * @remarks
 * Side-effect imports of plugin files (e.g. `src/tasks/index.js`) call
 * `TaskRegistry.register(...)` which delegates here. Per-run registries created
 * via `new TaskRegistry()` are completely independent of this instance.
 */
const defaultRegistry = new TaskRegistry();
