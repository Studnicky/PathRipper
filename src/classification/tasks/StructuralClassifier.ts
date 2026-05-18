/**
 * @fileoverview `classify:structural` pipeline task — required-keys and
 * literal-discriminator gate (legacy class + self-registering silo plugin).
 *
 * @remarks
 * Evaluates a frozen set of pre-compiled structural rules against each record.
 * Each matching rule emits one {@link ClassificationProposalInterface} onto
 * `state.classifications`. Multiple rules may match the same record, producing
 * multiple proposals — conflict resolution is the responsibility of the
 * ConflictResolver (C4).
 *
 * **Module side effects** (per the v0.7.0 silo migration, task #13):
 *
 * 1. {@link TaskRegistry.register}`('classify:structural', task,
 *    { proposesClass: true })` — registers the per-record task that reads the
 *    cached compiled rule list (populated by `onRunStart`) and pushes one
 *    proposal per matching rule onto `state.classifications`.
 *
 * 2. {@link TaskRegistry.registerHook}`('classify:structural', 'onRunStart', ...)` —
 *    reads the per-plugin config namespace `ctx.config.structural`, AJV-validates
 *    it via `ctx.ajv`, compiles every predicate via {@link Predicate.compile},
 *    and caches the compiled rule list in a module-private slot. The hook
 *    no-ops when `ctx.config.structural` is absent.
 *
 * The legacy class-based {@link StructuralClassifier} is retained for the
 * existing {@link ClassificationFactory} wiring. Task #24 rewires the
 * orchestrator to drive the lifecycle hook chain and discard the factory.
 *
 * @module
 * @since 0.1.0
 * @category Classification
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { NextFnInterface, TaskFnInterface } from '../../types/Pipeline.js';
import type {
  PipelineContextInterface,
  PipelineStateInterface,
  ClassificationProposalInterface,
} from '../../types/PipelineState.js';
import type { CompiledPredicateInterface, RawPredicate } from '../predicates/Predicate.js';
import { Predicate } from '../predicates/Predicate.js';
import { OutputConfigError } from '../../errors/OutputConfigError.js';
import { Logger } from '../../modules/logger/logger.js';
import { TaskRegistry } from '../../registry/TaskRegistry.js';
import { evaluateRules } from './_shared.js';

const logger = Logger.forComponent('StructuralClassifier');

// ─── Plugin constants ────────────────────────────────────────────────────────

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

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * A single pre-compiled structural classification rule.
 *
 * @remarks
 * Rules are compiled once at startup by the factory (C5) via
 * {@link Predicate.compile}; this interface only carries the compiled form.
 * The `reasons` array is pre-computed at compile time so no string
 * interpolation occurs on the hot per-record path.
 *
 * @category Classification
 * @since 0.1.0
 * @see {@link StructuralClassifier}
 * @group Types
 */
export interface StructuralRuleInterface {
  /** Proposed ontology class id for records matched by this rule. */
  readonly className: string;
  /** Numeric priority forwarded verbatim onto the emitted proposal; ConflictResolver picks the highest. */
  readonly priority:  number;
  /** Already-compiled predicate, evaluated per-record at hot-path speed via {@link Predicate.evaluate}. */
  readonly predicate: CompiledPredicateInterface;
  /** Pre-computed human-readable evidence reasons preserved verbatim into the final classification. */
  readonly reasons:   ReadonlyArray<string>;
}

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

// ── Plugin config schema ──────────────────────────────────────────────────────

/**
 * AJV schema fragment validating the `structural` config namespace.
 *
 * @remarks
 * Resolves predicate shapes via `$ref` to the shared predicate schema
 * registered with the run-wide AJV instance during `onRunStart`. Mirrors the
 * embedded schema fragment in `src/config/SquashageConfig.ts` for the
 * legacy `classification.structural` block — kept verbatim so configs valid
 * under the legacy schema remain valid here.
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

// ── StructuralClassifier (legacy class) ───────────────────────────────────────

/**
 * Classifier task that evaluates a frozen decision-table of structural rules.
 *
 * @remarks
 * Each rule carries a {@link CompiledPredicateInterface} pre-built by the
 * factory. On every record, the classifier iterates the rule list and emits
 * one {@link ClassificationProposalInterface} per matching rule with
 * `source: 'classify:structural'`. All matching rules produce proposals;
 * the ConflictResolver selects the winner based on `priority`.
 *
 * The constructor freezes the `rules` reference so the rule set is immutable
 * after construction.
 *
 * @example
 * ```ts
 * const rules: StructuralRuleInterface[] = [
 *   {
 *     className: 'feat',
 *     priority:  10,
 *     predicate: Predicate.compile({ path: '/_type', equals: 'feat' }),
 *     reasons:   ['_type=feat'],
 *   },
 * ];
 * const classifier = new StructuralClassifier(rules);
 * registry.register('classify:structural', classifier.execute);
 * ```
 *
 * @category Classification
 * @since 0.1.0
 * @see {@link StructuralRuleInterface}
 * @see {@link ClassificationProposalInterface}
 * @group Classifiers
 */
export class StructuralClassifier {
  /** Frozen rule list; evaluated per-record on the hot path. */
  readonly #rules: ReadonlyArray<StructuralRuleInterface>;

  /**
   * Creates a {@link StructuralClassifier} instance with the given rule set.
   *
   * @param rules - Already-compiled structural rules. The constructor freezes
   *   the array reference. Each rule's predicate evaluates to `true` iff the
   *   record matches.
   * @throws {OutputConfigError} When `rules` is empty — an empty rule set
   *   indicates a misconfigured pipeline and should fail fast at startup.
   */
  public constructor(rules: ReadonlyArray<StructuralRuleInterface>) {
    if (rules.length === 0) {
      throw OutputConfigError.create(
        'StructuralClassifier requires at least one rule; received an empty rules array.',
        { metadata: { ruleCount: 0 } },
      );
    }

    this.#rules = Object.freeze([...rules]);

    // Bind execute so it can be passed as a bare function reference to
    // TaskRegistry.register() without losing its `this` context.
    this.execute = this.#executeImpl.bind(this);
  }

  /**
   * Bound pipeline task function for `classify:structural`.
   *
   * @remarks
   * Public class field; safe to pass as a bare reference to
   * {@link TaskRegistry.register} — `this` binding is captured at
   * construction time.
   */
  public readonly execute: TaskFnInterface<PipelineStateInterface>;

  // ── Private implementation ────────────────────────────────────────────────

  async #executeImpl(
    next:  NextFnInterface,
    state: PipelineStateInterface,
  ): Promise<void> {
    logger.debug('execute', 'StructuralClassifier invoked', {
      targetId:  state.targetId,
      ruleCount: this.#rules.length,
    });

    const newProposals = evaluateRules(this.#rules, 'classify:structural', state.input);

    if (newProposals.length > 0) {
      (state as unknown as { classifications: ReadonlyArray<ClassificationProposalInterface> })
        .classifications = [...state.classifications, ...newProposals];

      logger.info('execute', 'Structural proposals emitted', {
        targetId:      state.targetId,
        proposalCount: newProposals.length,
      });
    } else {
      logger.debug('execute', 'No structural rules matched', { targetId: state.targetId });
    }

    await next();
  }
}

// ── Plugin self-registration (silo migration, task #13) ───────────────────────

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
 *
 * @internal
 */
let compiledRules: ReadonlyArray<CompiledStructuralRuleInterface> | null = null;

/**
 * Loads the shared predicate schema from disk and registers it with
 * `ctx.ajv` if not already present. Idempotent — safe to call once per run.
 *
 * @internal
 */
function ensurePredicateSchema(ctx: PipelineContextInterface): void {
  if (ctx.ajv.getSchema(PREDICATE_SCHEMA_ID) !== undefined) {
    return;
  }
  const text = readFileSync(PREDICATE_SCHEMA_PATH, 'utf-8');
  const json = JSON.parse(text) as object;
  ctx.ajv.addSchema(json);
}

/**
 * `onRunStart` hook for `classify:structural`.
 *
 * @remarks
 * Reads `ctx.config['structural']`, validates it via `ctx.ajv`, compiles every
 * raw predicate into a {@link CompiledPredicateInterface}, and caches the
 * compiled rules on the module-private slot.
 *
 * Fail-fast: invalid config throws {@link OutputConfigError} BEFORE any
 * per-record dispatch, per the silo contract's
 * "Producers run before consumers" rule.
 *
 * Optional: when `ctx.config.structural` is absent or `undefined`, the hook
 * clears the cache and returns silently — the plugin is a no-op for the run.
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

/**
 * Per-record task body for `classify:structural` (plugin form).
 *
 * @remarks
 * Reads the cached compiled rules populated by {@link onRunStart}. When the
 * cache is `null` (config absent) the task is a no-op. Otherwise it
 * evaluates each rule against `state.input` via {@link evaluateRules} and
 * appends one proposal per matching rule to `state.classifications`.
 *
 * @internal
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
