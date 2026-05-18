/**
 * @fileoverview `classify:rules` pipeline task — decision-table classifier over compiled predicates.
 *
 * @remarks
 * Evaluates a frozen decision-table of pre-compiled rules against each record.
 * Each matching rule emits one {@link ClassificationProposalInterface} onto
 * `state.classifications`. Multiple rules may match the same record, producing
 * multiple proposals — conflict resolution is the responsibility of the
 * ConflictResolver (C4).
 *
 * While the evaluation engine is structurally identical to
 * {@link StructuralClassifier}, the two classes are intentionally kept separate:
 * they represent distinct pipeline stages with distinct config shapes and
 * operational intent. `classify:structural` gates on required-keys and
 * discriminators; `classify:rules` applies the full semantic decision-table.
 *
 * **Module side effects** (per the v0.7.0 silo migration, task #14):
 *
 * 1. `TaskRegistry.registerHook('classify:rules', 'onRunStart', ...)` — reads
 *    the per-plugin config namespace `ctx.config.rules`, AJV-validates it via
 *    `ctx.ajv`, compiles every predicate via {@link Predicate.compile}, and
 *    caches the compiled rule list in a module-private `WeakMap` keyed by the
 *    context object. The hook no-ops when `ctx.config.rules` is absent so the
 *    plugin is safe to import unconditionally.
 *
 * 2. `TaskRegistry.register('classify:rules', task, { proposesClass: true })` —
 *    self-registers the per-record task that reads `state.input`, evaluates
 *    every cached compiled rule, and pushes one proposal per matching rule
 *    onto `state.classifications`.
 *
 * The legacy {@link RulesClassifier} class is retained for the existing
 * {@link ClassificationFactory} wiring (which constructs an instance and
 * registers `.execute` onto a per-run registry). Once the orchestrator is
 * rewired to drive lifecycle hooks (a follow-up silo-migration task), the
 * factory path is deleted and only the self-registered plugin form remains.
 *
 * @module
 * @since 0.1.0
 * @category Classification
 */

import type { ValidateFunction } from 'ajv';

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

const logger = Logger.forComponent('RulesClassifier');

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * A single pre-compiled decision-table rule entry.
 *
 * @remarks
 * Rules are compiled once at startup by the factory (C5) via
 * {@link Predicate.compile}; this interface only carries the compiled form.
 * The `reasons` array is pre-computed at compile time so no string
 * interpolation occurs on the hot per-record path.
 *
 * @category Classification
 * @since 0.1.0
 * @see {@link RulesClassifier}
 * @group Types
 */
export interface RuleEntryInterface {
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
 * A single raw rule entry as it appears under `config.rules[]` in the per-plugin
 * config namespace consumed by the `classify:rules` `onRunStart` hook.
 *
 * @remarks
 * The hook compiles every entry's `predicate` via {@link Predicate.compile} once
 * at startup. The compiled form ({@link RuleEntryInterface}) is then evaluated
 * per-record on the hot path with no further allocation.
 *
 * @category Classification
 * @since 0.7.0
 * @group Types
 */
export interface RawRulesEntryInterface {
  /** Proposed ontology class id for records matched by this rule. */
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
 * AJV schema fragment for `config.rules` (the per-plugin config namespace
 * consumed by the `classify:rules` `onRunStart` hook).
 *
 * @remarks
 * Validates structural shape only; the body of `predicate` is left as a
 * generic object because {@link Predicate.compile} performs the precise
 * vocabulary check and throws {@link OutputConfigError} on unknown operator
 * keys with richer diagnostics than AJV would produce.
 *
 * Exported so other plugins (and future config-aggregation tooling) may
 * compose it; not part of the silo contract.
 *
 * @category Classification
 * @since 0.7.0
 * @group Schema
 */
export const RULES_CONFIG_SCHEMA = {
  type:     'array',
  minItems: 1,
  items: {
    type: 'object',
    required: ['className', 'priority', 'predicate', 'reasons'],
    additionalProperties: false,
    properties: {
      className: { type: 'string', minLength: 1 },
      priority:  { type: 'number' },
      predicate: { type: 'object' },
      reasons: {
        type: 'array',
        items: { type: 'string' },
      },
    },
  },
} as const;

// ── RulesClassifier ───────────────────────────────────────────────────────────

/**
 * Classifier task that evaluates a frozen decision-table of semantic rules.
 *
 * @remarks
 * Each rule carries a {@link CompiledPredicateInterface} pre-built by the
 * factory. On every record, the classifier iterates the rule list and emits
 * one {@link ClassificationProposalInterface} per matching rule with
 * `source: 'classify:rules'`. All matching rules produce proposals;
 * the ConflictResolver selects the winner based on `priority`.
 *
 * The constructor freezes the `rules` reference so the rule set is immutable
 * after construction.
 *
 * @example
 * ```ts
 * const rules: RuleEntryInterface[] = [
 *   {
 *     className: 'feat',
 *     priority:  20,
 *     predicate: Predicate.compile({
 *       all: [
 *         { path: '/_type', equals: 'feat' },
 *         { path: '/level', type: 'number' },
 *       ],
 *     }),
 *     reasons: ['_type=feat', 'level present'],
 *   },
 * ];
 * const classifier = new RulesClassifier(rules);
 * registry.register('classify:rules', classifier.execute);
 * ```
 *
 * @category Classification
 * @since 0.1.0
 * @see {@link RuleEntryInterface}
 * @see {@link ClassificationProposalInterface}
 * @group Classifiers
 */
export class RulesClassifier {
  /** Frozen rule list; evaluated per-record on the hot path. */
  readonly #rules: ReadonlyArray<RuleEntryInterface>;

  /**
   * Creates a {@link RulesClassifier} instance with the given rule set.
   *
   * @param rules - Compiled decision-table rules. The constructor freezes the
   *   array reference. Each rule's predicate evaluates to `true` iff the record
   *   matches.
   * @throws {OutputConfigError} When `rules` is empty — an empty rule set
   *   indicates a misconfigured pipeline and should fail fast at startup.
   */
  public constructor(rules: ReadonlyArray<RuleEntryInterface>) {
    if (rules.length === 0) {
      throw OutputConfigError.create(
        'RulesClassifier requires at least one rule; received an empty rules array.',
        { metadata: { ruleCount: 0 } },
      );
    }

    this.#rules = Object.freeze([...rules]);

    // Bind execute so it can be passed as a bare function reference to
    // TaskRegistry.register() without losing its `this` context.
    this.execute = this.#executeImpl.bind(this);
  }

  /**
   * Bound pipeline task function for `classify:rules`.
   *
   * @remarks
   * Public class field; safe to pass as a bare function reference to
   * {@link TaskRegistry.register} — `this` binding is captured at
   * construction time.
   */
  public readonly execute: TaskFnInterface<PipelineStateInterface>;

  // ── Private implementation ────────────────────────────────────────────────

  async #executeImpl(
    next:  NextFnInterface,
    state: PipelineStateInterface,
  ): Promise<void> {
    logger.debug('execute', 'RulesClassifier invoked', {
      targetId:  state.targetId,
      ruleCount: this.#rules.length,
    });

    const newProposals = evaluateRules(this.#rules, 'classify:rules', state.input);

    if (newProposals.length > 0) {
      (state as unknown as { classifications: ReadonlyArray<ClassificationProposalInterface> })
        .classifications = [...state.classifications, ...newProposals];

      logger.info('execute', 'Rules proposals emitted', {
        targetId:      state.targetId,
        proposalCount: newProposals.length,
      });
    } else {
      logger.debug('execute', 'No rules matched', { targetId: state.targetId });
    }

    await next();
  }
}

// ── Plugin self-registration (silo migration, task #14) ───────────────────────

/**
 * Per-context cache of compiled rules.
 *
 * @remarks
 * Populated by the `classify:rules` `onRunStart` hook from
 * `ctx.config.rules`; consumed by the `classify:rules` per-record task.
 * Keyed by the {@link PipelineContextInterface} object so concurrent runs in
 * the same process do not collide (one cache entry per run). The WeakMap
 * lets the cache release as soon as the run-context goes out of scope.
 *
 * @internal
 */
const compiledRulesByContext: WeakMap<
  PipelineContextInterface,
  ReadonlyArray<RuleEntryInterface>
> = new WeakMap();

/**
 * Compiles a single raw rule entry into a {@link RuleEntryInterface}.
 *
 * @remarks
 * Defers all predicate-shape validation to {@link Predicate.compile}, which
 * throws {@link OutputConfigError} with a precise diagnostic on any unknown
 * operator or invalid path. AJV has already validated the surrounding shape
 * (see {@link RULES_CONFIG_SCHEMA}).
 *
 * @internal
 */
function compileRuleEntry(raw: RawRulesEntryInterface): RuleEntryInterface {
  return {
    className: raw.className,
    priority:  raw.priority,
    predicate: Predicate.compile(raw.predicate),
    reasons:   raw.reasons,
  };
}

/**
 * `onRunStart` hook for `classify:rules`.
 *
 * @remarks
 * 1. Reads `ctx.config.rules` (per-plugin namespace per the silo contract).
 *    No-ops when absent so the plugin is safe to import in pipelines that
 *    do not use rule-based classification.
 * 2. AJV-compiles {@link RULES_CONFIG_SCHEMA} via the run-wide `ctx.ajv` and
 *    fails fast with {@link OutputConfigError} when validation fails.
 * 3. Compiles every predicate via {@link Predicate.compile} and caches the
 *    result in {@link compiledRulesByContext} keyed by `ctx`.
 *
 * @internal
 */
function rulesOnRunStart(ctx: PipelineContextInterface): void {
  const rawRules = (ctx.config as Readonly<Record<string, unknown>>)['rules'];
  if (rawRules === undefined) {
    logger.debug('onRunStart', 'no classify:rules config; hook left dormant', { targetId: ctx.target });
    return;
  }

  const validate: ValidateFunction = ctx.ajv.compile(RULES_CONFIG_SCHEMA);
  if (!validate(rawRules)) {
    const errors = validate.errors ?? [];
    throw OutputConfigError.create(
      `classify:rules: invalid config.rules — ${errors.map(e => `${e.instancePath} ${e.message ?? ''}`).join('; ')}`,
      { metadata: { targetId: ctx.target, errors: errors as unknown as Record<string, unknown>[] } },
    );
  }

  const entries  = rawRules as ReadonlyArray<RawRulesEntryInterface>;
  const compiled = Object.freeze(entries.map(compileRuleEntry));
  compiledRulesByContext.set(ctx, compiled);

  logger.info('onRunStart', 'classify:rules compiled', {
    targetId:  ctx.target,
    ruleCount: compiled.length,
  });
}

/**
 * Per-record task function for `classify:rules`.
 *
 * @remarks
 * Reads the compiled rule list cached at `onRunStart` and pushes one
 * {@link ClassificationProposalInterface} per matching rule onto
 * `state.classifications`. When no rules were configured (cache miss), the
 * task no-ops and chains to `next` — the pipeline is permitted to include
 * `classify:rules` even when no rules are defined.
 *
 * @internal
 */
const rulesTask: TaskFnInterface<PipelineStateInterface> = async (
  next:  NextFnInterface,
  state: PipelineStateInterface,
): Promise<void> => {
  const ctx = state.context;
  const compiled = ctx !== undefined ? compiledRulesByContext.get(ctx) : undefined;

  if (compiled === undefined || compiled.length === 0) {
    logger.debug('execute', 'classify:rules cache empty; no proposals emitted', {
      targetId: state.targetId,
    });
    await next();
    return;
  }

  const newProposals = evaluateRules(compiled, 'classify:rules', state.input);

  if (newProposals.length > 0) {
    (state as unknown as { classifications: ReadonlyArray<ClassificationProposalInterface> })
      .classifications = [...state.classifications, ...newProposals];

    logger.info('execute', 'Rules proposals emitted', {
      targetId:      state.targetId,
      proposalCount: newProposals.length,
    });
  } else {
    logger.debug('execute', 'No rules matched', { targetId: state.targetId });
  }

  await next();
};

TaskRegistry.registerHook('classify:rules', 'onRunStart', rulesOnRunStart);
TaskRegistry.register('classify:rules', rulesTask, { proposesClass: true });
