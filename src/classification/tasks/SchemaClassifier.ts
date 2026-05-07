/**
 * @fileoverview Schema-based classifier — self-registering plugin module that
 * uses the run-wide shared `ctx.ajv` instance to compile per-class JSON
 * Schemas and emit one `classify:schema` proposal per validator match.
 *
 * @remarks
 * This module participates in two surfaces:
 *
 * 1. **Self-registering plugin (silo path, v0.7.0+).** At module load time it
 *    calls {@link TaskRegistry.registerHook}('classify:schema', 'onRunStart',
 *    ...) and {@link TaskRegistry.register}('classify:schema', ...). The hook
 *    validates the plugin-namespaced config (`ctx.config.schemas`) against a
 *    private AJV config schema, reads each per-class JSON Schema file from the
 *    `__schemasBase` bridge directory, and compiles each schema via
 *    `ctx.ajv.compile(...)` — explicitly NOT a private AJV. Compiled
 *    validators are cached on a module-private map keyed by `ctx.target`. The
 *    per-record task then iterates the cache and appends a proposal per match.
 *
 * 2. **Legacy `SchemaClassifier` class (factory path).** The
 *    {@link SchemaClassifier} class is preserved verbatim for
 *    {@link ClassificationFactory.build}, which still constructs it with
 *    pre-compiled AJV entries during the orchestrator's startup loop. Both
 *    paths coexist during the v0.7.0 silo migration; the factory call site
 *    will be removed once every classifier is silo-native.
 *
 * The plugin uses `ctx.ajv` instead of building its own AJV. This is the
 * load-bearing change: it puts user-loaded JSON Schemas onto the same AJV
 * instance as every other plugin's compile (config validation, future custom
 * keywords). See `tests/unit/classification/schemaClassifier.ajvIsolation.test.ts`
 * for the documented behaviour at the `$id` collision boundary.
 *
 * @module
 * @since 2.2.0
 * @category Classification
 */

import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import type { ValidateFunction } from 'ajv';

import type { TaskFnInterface, NextFnInterface } from '../../types/Pipeline.js';
import type {
  PipelineContextInterface,
  PipelineStateInterface,
  ClassificationProposalInterface,
} from '../../types/PipelineState.js';
import { AjvClassifier, type AjvClassEntryInterface } from '../AjvClassifier.js';
import { TaskRegistry }     from '../../registry/TaskRegistry.js';
import { OutputConfigError } from '../../errors/OutputConfigError.js';
import { Logger }            from '../../modules/logger/logger.js';

const logger = Logger.forComponent('SchemaClassifier');

// ── Plugin namespace ──────────────────────────────────────────────────────────

/** Registered task / hook name. */
const TASK_NAME = 'classify:schema' as const;

// ── Config types ──────────────────────────────────────────────────────────────

/**
 * One raw entry in the plugin's config namespace. Mirrors the legacy
 * `RawSchemaEntryInterface` from {@link ClassificationFactory} so the same
 * config block compiles under both surfaces.
 */
interface RawSchemaEntryInterface {
  readonly className:  string;
  readonly priority:   number;
  readonly schemaPath: string;
}

/**
 * Bridge interface — `__schemasBase` lives on `ctx.config` per the same
 * convention used by `context:ontology` and `context:prefixes` until the
 * orchestrator threads it through a typed init record.
 *
 * @internal
 */
interface CtxConfigBridgeInterface {
  readonly __schemasBase?: string | undefined;
  readonly schemas?:       ReadonlyArray<RawSchemaEntryInterface> | undefined;
}

/**
 * AJV schema fragment validating the plugin's config namespace. Compiled
 * once-per-run via `ctx.ajv.compile` at `onRunStart`. Failure is fail-fast.
 */
const CONFIG_SCHEMA = {
  type:  'array',
  items: {
    type:       'object',
    required:   ['className', 'priority', 'schemaPath'],
    properties: {
      className:  { type: 'string', minLength: 1 },
      priority:   { type: 'number' },
      schemaPath: { type: 'string', minLength: 1 },
    },
    additionalProperties: false,
  },
} as const;

// ── Module-private compiled-validator cache ───────────────────────────────────

/**
 * Cache of compiled validators keyed by `ctx.target`. Populated at
 * `onRunStart`; consumed per-record. Cleared by the test harness via
 * {@link __resetForTests}.
 */
const compiledByTarget = new Map<string, ReadonlyArray<AjvClassEntryInterface>>();

/**
 * @internal Test-only reset hook. Production code never calls this.
 */
export function __resetForTests(): void {
  compiledByTarget.clear();
}

// ── onRunStart hook (silo path) ───────────────────────────────────────────────

TaskRegistry.registerHook(TASK_NAME, 'onRunStart', (ctx: PipelineContextInterface) => {
  const config  = ctx.config as Readonly<Record<string, unknown>> & CtxConfigBridgeInterface;
  const entries = config.schemas;

  if (entries === undefined || entries.length === 0) {
    logger.debug('onRunStart', 'no classify:schema config; plugin disabled for this run', {
      target: ctx.target,
    });
    compiledByTarget.delete(ctx.target);
    return;
  }

  // Validate config namespace via the SHARED ctx.ajv. This is the load-bearing
  // change versus the legacy factory: every plugin sharing this AJV instance
  // can interleave schema compiles, custom keywords, and config validation
  // without each rebuilding its own AJV.
  const validateConfig = ctx.ajv.compile(CONFIG_SCHEMA);
  if (!validateConfig(entries)) {
    throw OutputConfigError.create(
      `classify:schema: invalid config namespace (ctx.config.schemas): ${ctx.ajv.errorsText(validateConfig.errors)}`,
      { metadata: { target: ctx.target, errors: validateConfig.errors } },
    );
  }

  const schemasBase = config.__schemasBase ?? process.cwd();
  const compiled: AjvClassEntryInterface[] = entries.map((raw) => {
    const absPath = resolvePath(schemasBase, raw.schemaPath);
    logger.debug('onRunStart', 'loading schema file', {
      target: ctx.target,
      className: raw.className,
      absPath,
    });

    let schemaText: string;
    try {
      schemaText = readFileSync(absPath, 'utf-8');
    } catch (err) {
      const cause = err instanceof Error ? err : undefined;
      throw OutputConfigError.create(
        `classify:schema: cannot read schema file for class "${raw.className}" at ${absPath}: ${cause?.message ?? String(err)}`,
        { cause, metadata: { target: ctx.target, className: raw.className, schemaPath: absPath } },
      );
    }

    let schemaJson: unknown;
    try {
      schemaJson = JSON.parse(schemaText) as unknown;
    } catch (err) {
      const cause = err instanceof Error ? err : undefined;
      throw OutputConfigError.create(
        `classify:schema: cannot parse schema JSON for class "${raw.className}" at ${absPath}: ${cause?.message ?? String(err)}`,
        { cause, metadata: { target: ctx.target, className: raw.className, schemaPath: absPath } },
      );
    }

    let validate: ValidateFunction;
    try {
      validate = ctx.ajv.compile(schemaJson as object);
    } catch (err) {
      const cause = err instanceof Error ? err : undefined;
      throw OutputConfigError.create(
        `classify:schema: AJV compilation failed for class "${raw.className}" at ${absPath}: ${cause?.message ?? String(err)}`,
        { cause, metadata: { target: ctx.target, className: raw.className, schemaPath: absPath } },
      );
    }

    return {
      className: raw.className,
      priority:  raw.priority,
      validate,
    };
  });

  compiledByTarget.set(ctx.target, compiled);
  logger.debug('onRunStart', 'compiled per-class schemas via ctx.ajv', {
    target: ctx.target,
    count:  compiled.length,
  });
});

// ── Per-record task (silo path) ───────────────────────────────────────────────

const classifySchemaTask: TaskFnInterface<PipelineStateInterface> = async (
  next:  NextFnInterface,
  state: PipelineStateInterface,
): Promise<void> => {
  const target  = state.targetId;
  const entries = compiledByTarget.get(target);

  if (entries === undefined || entries.length === 0) {
    // Plugin not configured for this target; pass through.
    await next();
    return;
  }

  const proposals: ClassificationProposalInterface[] = [];
  for (const entry of entries) {
    if (entry.validate(state.input)) {
      proposals.push({
        source:     'classify:schema',
        className:  entry.className,
        priority:   entry.priority,
        confidence: 1,
        reasons:    [`schema:${entry.className} matched`],
      });
    }
  }

  if (proposals.length > 0) {
    (state as unknown as { classifications: ReadonlyArray<ClassificationProposalInterface> }).classifications = [
      ...state.classifications,
      ...proposals,
    ];
  }

  await next();
};

TaskRegistry.register(TASK_NAME, classifySchemaTask, { proposesClass: true });

// ── Legacy SchemaClassifier class (factory path) ──────────────────────────────

/**
 * Idiomatic task class wrapping an {@link AjvClassifier} for use in the
 * Squashage pipeline.
 *
 * @remarks
 * Preserved as the factory-path entry point during the v0.7.0 silo migration.
 * The factory ({@link ClassificationFactory.build}) constructs this class with
 * pre-compiled AJV entries assembled against a private AJV instance. The
 * silo-path plugin above bypasses this class entirely and uses `ctx.ajv`.
 *
 * Instantiate once per pipeline target (or per target configuration), then
 * register or supply `instance.execute` as the task function. The constructor
 * validates that at least one class entry is provided; subsequent calls to
 * `execute` are pure and do not mutate engine state.
 *
 * The task appends proposals to `state.classifications` **immutably** — the
 * existing array is never mutated; a new `ReadonlyArray` is spread each run.
 * `next()` is always called after classification regardless of whether any
 * proposals matched.
 *
 * @example
 * ```ts
 * const classifier = new SchemaClassifier([
 *   { className: 'feat', priority: 10, validate: ajv.compile(featSchema) },
 * ]);
 * pipeline.use(classifier.execute);
 * ```
 *
 * @category Classification
 * @since 2.2.0
 * @see {@link AjvClassifier}
 * @see {@link AjvClassEntryInterface}
 * @group Tasks
 */
export class SchemaClassifier {
  readonly #engine: AjvClassifier;

  /**
   * @param entries - Ordered AJV class entries. Forwarded verbatim to
   *   {@link AjvClassifier}; see its constructor for validation rules.
   * @throws {OutputConfigError} When `entries` is empty.
   */
  constructor(entries: ReadonlyArray<AjvClassEntryInterface>) {
    this.#engine = new AjvClassifier(entries);
    logger.debug('constructor', 'SchemaClassifier initialised', { count: entries.length });
  }

  /**
   * Pipeline task function bound to this instance.
   *
   * @remarks
   * Classifies `state.input` via the underlying {@link AjvClassifier}, appends
   * any returned proposals to `state.classifications` immutably, and calls
   * `next()` unconditionally. Logging is emitted at `debug` level for each
   * invocation.
   *
   * @param next  - Pipeline continuation; called once after classification.
   * @param state - Mutable pipeline state for the current record.
   */
  public readonly execute: TaskFnInterface<PipelineStateInterface> = async (
    next: NextFnInterface,
    state: PipelineStateInterface,
  ): Promise<void> => {
    logger.debug('execute', 'Running schema classification', { targetId: state.targetId });

    const proposals: ReadonlyArray<ClassificationProposalInterface> = this.#engine.classify(state.input);

    if (proposals.length > 0) {
      logger.debug('execute', `Appending ${proposals.length.toString()} proposal(s) to state.classifications`, { count: proposals.length });
      (state as unknown as { classifications: ReadonlyArray<ClassificationProposalInterface> }).classifications = [
        ...state.classifications,
        ...proposals,
      ];
    }

    await next();
  };
}
