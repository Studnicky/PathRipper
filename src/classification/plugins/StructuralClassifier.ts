/**
 * @fileoverview `classify:structural` self-registering plugin module.
 *
 * @remarks
 * v0.7.0 silo migration (task #13). Reframes the legacy
 * {@link StructuralClassifier} class (in `src/classification/tasks/`) as a
 * silo-aware plugin module that:
 *
 * 1. Self-registers via top-level {@link TaskRegistry} calls at import time,
 *    parallel to the `aonprd:squash` plugin pattern in
 *    `tests/e2e/aonprd/plugin.ts`.
 * 2. Exposes an AJV schema fragment ({@link STRUCTURAL_CONFIG_SCHEMA}) that
 *    validates the `structural` config namespace — an array of raw rules with
 *    `className`, `priority`, `predicate`, `reasons`. Predicates conform to
 *    the {@link RawPredicate} closed vocabulary defined in
 *    `src/schemas/predicate.schema.json`.
 * 3. Runs an `onRunStart` lifecycle hook that reads
 *    `ctx.config['structural']`, validates it against
 *    {@link STRUCTURAL_CONFIG_SCHEMA} via `ctx.ajv`, and compiles every raw
 *    predicate into a {@link CompiledPredicateInterface} via
 *    {@link Predicate.compile}. The compiled rules are cached on a
 *    module-private slot for the duration of the run.
 * 4. Per-record task reads `state.input`, evaluates the cached compiled rules
 *    via the shared {@link evaluateRules} helper, and pushes one
 *    {@link ClassificationProposalInterface} per matching rule onto
 *    `state.classifications`. The conflict resolver picks the winner.
 * 5. Declares `proposesClass: true` in its registration manifest so the
 *    orchestrator can count proposers for the
 *    "≥2 proposers requires `classify:conflict`" check (task #25).
 *
 * The legacy class-based {@link StructuralClassifier} in
 * `src/classification/tasks/StructuralClassifier.ts` continues to exist —
 * `ClassificationFactory` still drives the actual `classify:structural` task
 * registration in the orchestrator. Task #24 rewires the orchestrator to
 * drive the lifecycle hook chain and discard the factory; task #25 deletes
 * the factory.
 *
 * @module classification/plugins/StructuralClassifier
 * @category Classification
 * @since 0.7.0
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TaskRegistry }                from '../../registry/TaskRegistry.js';
import type { NextFnInterface, TaskFnInterface } from '../../types/Pipeline.js';
import type {
  ClassificationProposalInterface,
  PipelineContextInterface,
  PipelineStateInterface,
} from '../../types/PipelineState.js';
import { OutputConfigError }           from '../../errors/OutputConfigError.js';
import { Predicate }                    from '../predicates/Predicate.js';
import type { CompiledPredicateInterface, RawPredicate } from '../predicates/Predicate.js';
import { evaluateRules }                from '../tasks/_shared.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Registered task name for the structural classifier plugin. */
export const STRUCTURAL_PLUGIN_NAME = 'classify:structural' as const;

/** Config namespace key on `ctx.config` consumed by this plugin. */
export const STRUCTURAL_CONFIG_KEY = 'structural' as const;

/** $id of the shared predicate schema this plugin's config schema references. */
const PREDICATE_SCHEMA_ID = 'https://squashage.dev/schemas/predicate.json' as const;

/** Absolute path to the shared predicate schema JSON, resolved at module load. */
const PREDICATE_SCHEMA_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../schemas/predicate.schema.json',
);

// ─── Public types ────────────────────────────────────────────────────────────

/**
 * A single raw structural rule entry from the `structural` config namespace.
 *
 * @remarks
 * Mirrors the legacy `RawStructuralRuleInterface` from
 * `ClassificationFactory.ts`. Predicates are compiled at `onRunStart` time —
 * never on the per-record hot path.
 *
 * @category Classification
 * @since 0.7.0
 * @group Types
 */
export interface RawStructuralRuleInterface {
  /** Ontology class id proposed by this rule. */
  readonly className: string;
  /** Numeric priority; ConflictResolver picks the highest. */
  readonly priority:  number;
  /** Raw predicate descriptor; compiled once at `onRunStart`. */
  readonly predicate: RawPredicate;
  /** Pre-defined human-readable evidence reasons. */
  readonly reasons:   ReadonlyArray<string>;
}

/**
 * AJV schema fragment validating the `structural` config namespace.
 *
 * @remarks
 * Resolves predicate shapes via `$ref` to the shared predicate schema
 * registered with the run-wide AJV instance during `onRunStart`. Mirrors the
 * embedded schema fragment in `src/config/SquashageConfig.ts` for the
 * legacy `classification.structural` block — kept verbatim so configs valid
 * under the legacy schema remain valid here. Will become the canonical
 * schema fragment when task #25 deletes the legacy `classification.*` block.
 *
 * @category Classification
 * @since 0.7.0
 */
export const STRUCTURAL_CONFIG_SCHEMA = {
  $id: 'https://squashage.dev/schemas/plugins/classify-structural.json',
  type: 'array',
  minItems: 1,
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['className', 'priority', 'predicate', 'reasons'],
    properties: {
      className: { type: 'string', minLength: 1 },
      priority:  { type: 'number' },
      predicate: { $ref: PREDICATE_SCHEMA_ID },
      reasons:   { type: 'array', items: { type: 'string' } },
    },
  },
} as const;

// ─── Module-private state ────────────────────────────────────────────────────

/** Shape of a compiled rule kept in the module-private cache. */
interface CompiledStructuralRuleInterface {
  readonly className: string;
  readonly priority:  number;
  readonly predicate: CompiledPredicateInterface;
  readonly reasons:   ReadonlyArray<string>;
}

/**
 * Compiled rules cached during `onRunStart`.
 *
 * @remarks
 * The orchestrator processes one target at a time, so a single closure-held
 * slot suffices. `null` means either (a) the plugin's `onRunStart` has not
 * yet fired, or (b) the target's config has no `structural` namespace and
 * the plugin is a no-op for the run. The per-record task treats both cases
 * identically — it emits zero proposals and advances `next()`.
 *
 * Re-running `onRunStart` overwrites this slot, so multi-target runs that
 * loop the lifecycle work correctly.
 */
let compiledRules: ReadonlyArray<CompiledStructuralRuleInterface> | null = null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Loads the shared predicate schema from disk and registers it with
 * `ctx.ajv` if not already present. Idempotent — safe to call once per run.
 *
 * @param ctx - Run-wide context carrying the shared AJV instance.
 */
function ensurePredicateSchema(ctx: PipelineContextInterface): void {
  if (ctx.ajv.getSchema(PREDICATE_SCHEMA_ID) !== undefined) {
    return;
  }
  const text = readFileSync(PREDICATE_SCHEMA_PATH, 'utf-8');
  const json = JSON.parse(text) as object;
  ctx.ajv.addSchema(json);
}

// ─── Lifecycle hook: onRunStart ──────────────────────────────────────────────

/**
 * Reads `ctx.config['structural']`, validates it via `ctx.ajv`, compiles every
 * raw predicate into a {@link CompiledPredicateInterface}, and caches the
 * compiled rules on the module-private slot.
 *
 * @remarks
 * Fail-fast: invalid config throws {@link OutputConfigError} BEFORE any
 * per-record dispatch, per the silo contract's
 * "Producers run before consumers" rule.
 *
 * Optional: when `ctx.config.structural` is absent or `undefined`, the hook
 * clears the cache and returns silently — the plugin is a no-op for the run.
 * This mirrors the legacy factory's "absent sub-key skips instantiation"
 * behaviour.
 */
export function onRunStart(ctx: PipelineContextInterface): void {
  const raw = ctx.config[STRUCTURAL_CONFIG_KEY];
  if (raw === undefined) {
    compiledRules = null;
    return;
  }

  ensurePredicateSchema(ctx);

  const validate = ctx.ajv.compile(STRUCTURAL_CONFIG_SCHEMA);
  if (!validate(raw)) {
    throw OutputConfigError.create(
      `${STRUCTURAL_PLUGIN_NAME}: invalid config for "${STRUCTURAL_CONFIG_KEY}" — ${ctx.ajv.errorsText(validate.errors)}`,
      {
        metadata: {
          plugin:    STRUCTURAL_PLUGIN_NAME,
          configKey: STRUCTURAL_CONFIG_KEY,
          errors:    validate.errors,
        },
      },
    );
  }

  const rules = raw as ReadonlyArray<RawStructuralRuleInterface>;
  compiledRules = Object.freeze(
    rules.map((r) => Object.freeze({
      className: r.className,
      priority:  r.priority,
      predicate: Predicate.compile(r.predicate),
      reasons:   Object.freeze([...r.reasons]),
    })),
  );
}

// ─── Per-record task ─────────────────────────────────────────────────────────

/**
 * Per-record task body for `classify:structural`.
 *
 * @remarks
 * Reads the cached compiled rules populated by {@link onRunStart}. When the
 * cache is `null` (config absent) the task is a no-op. Otherwise it
 * evaluates each rule against `state.input` via {@link evaluateRules} and
 * appends one proposal per matching rule to `state.classifications`.
 *
 * Mutation of `state.classifications` follows the legacy class-based
 * {@link StructuralClassifier} pattern — it casts to a writable slot to push
 * proposals; the silo contract designates `state.classifications` as
 * append-only during the proposer phase.
 */
const structuralTask: TaskFnInterface<PipelineStateInterface> = async (
  next:  NextFnInterface,
  state: PipelineStateInterface,
): Promise<void> => {
  if (compiledRules !== null && compiledRules.length > 0) {
    const newProposals = evaluateRules(compiledRules, STRUCTURAL_PLUGIN_NAME, state.input);
    if (newProposals.length > 0) {
      (state as unknown as { classifications: ReadonlyArray<ClassificationProposalInterface> })
        .classifications = [...state.classifications, ...newProposals];
    }
  }
  await next();
};

// ─── Test-only helpers ───────────────────────────────────────────────────────

/**
 * Resets the module-private compiled-rules cache.
 *
 * @internal Exposed for unit-test isolation only. Production code MUST NOT
 * call this — `onRunStart` clears and repopulates the cache deterministically.
 */
export function __resetForTests(): void {
  compiledRules = null;
}

/**
 * Returns whether the cache is currently populated (test introspection only).
 *
 * @internal Exposed for unit-test isolation only.
 */
export function __isCachePopulatedForTests(): boolean {
  return compiledRules !== null;
}

// ─── Self-registration (side-effect on import) ───────────────────────────────

TaskRegistry.register(STRUCTURAL_PLUGIN_NAME, structuralTask, { proposesClass: true });
// Carry `proposesClass: true` onto the lifecycle hook manifest as well —
// `TaskRegistry` keys manifests by name, so the hook registration would
// otherwise overwrite the per-record task's manifest and erase the
// `proposesClass` flag the orchestrator counts.
TaskRegistry.registerHook(STRUCTURAL_PLUGIN_NAME, 'onRunStart', onRunStart, { proposesClass: true });
