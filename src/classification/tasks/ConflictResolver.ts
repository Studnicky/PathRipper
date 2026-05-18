/**
 * @fileoverview `classify:conflict` pipeline task — cascade conflict resolver.
 *
 * @remarks
 * Reads the accumulated `state.classifications` proposals emitted by all
 * upstream `classify:*` tasks, filters out metadata sentinels, and selects the
 * winning class for the record. The result is written to `state.classification`
 * as a {@link ClassificationEvidenceInterface}. Records that cannot be resolved
 * are either quarantined or skipped, depending on configuration.
 *
 * Resolution algorithm:
 * 1. Filter metadata sentinels (`__source__`, `__validation__`, `unknown`).
 * 2. If no proposals remain → `onUnknown` policy (quarantine or skip).
 * 3. If all proposals agree on a single className → that class wins; confidence
 *    is taken from the highest-priority proposal; engine is the comma-joined
 *    set of unique sources.
 * 4. If proposals disagree (multi-class conflict):
 *    a. Identify the class(es) with the highest priority.
 *    b. One clear winner → it wins regardless of `onConflict`.
 *    c. Genuine tie (≥2 classes share the highest priority):
 *       - `pickPriority` → lexicographically first className wins; `candidates`
 *         lists all tied classNames.
 *       - `quarantine` → quarantine record under bucket `'conflicts'`; leave
 *         `state.classification` null.
 *
 * **Module side effects** (per the v0.7.0 silo migration, task #17):
 *
 * 1. `TaskRegistry.registerHook('classify:conflict', 'onRunStart', ...)` —
 *    reads the per-plugin config namespace `ctx.config.conflict`, AJV-validates
 *    it via `ctx.ajv`, and caches the validated config alongside `ctx.outDir`
 *    + `ctx.target` in a module-private `WeakMap` keyed by the context object.
 *    The hook no-ops when `ctx.config.conflict` is absent so the plugin is
 *    safe to import unconditionally.
 *
 * 2. `TaskRegistry.register('classify:conflict', task)` — self-registers the
 *    per-record task that reads `state.classifications`, runs the resolution
 *    algorithm, writes `state.classification`, and (when configured) writes a
 *    quarantine record under `<ctx.outDir>/<ctx.target>/quarantine/<bucket>/`.
 *    The plugin does NOT declare `proposesClass: true` — it consumes
 *    proposals, it does not produce them.
 *
 * The legacy {@link ConflictResolver} class is retained for the existing
 * {@link ClassificationFactory} wiring (which constructs an instance with the
 * factory's outDir/targetId and registers `.execute` onto a per-run registry).
 * Once the orchestrator is rewired to drive lifecycle hooks (a follow-up
 * silo-migration task), the factory path is deleted and only the
 * self-registered plugin form remains.
 *
 * @module
 * @since 0.1.0
 * @category Classification
 */

import { createHash } from 'node:crypto';

import type { ValidateFunction } from 'ajv';

import type { NextFnInterface, TaskFnInterface }                from '../../types/Pipeline.js';
import type {
  PipelineContextInterface,
  PipelineStateInterface,
  ClassificationProposalInterface,
  ClassificationEvidenceInterface,
} from '../../types/PipelineState.js';
import { QuarantineWriter }  from '../../quarantine/QuarantineWriter.js';
import { OutputConfigError } from '../../errors/OutputConfigError.js';
import { Logger }            from '../../modules/logger/logger.js';
import { TaskRegistry }      from '../../registry/TaskRegistry.js';

const logger = Logger.forComponent('ConflictResolver');

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Resolution policy configuration for {@link ConflictResolver}.
 *
 * @category Classification
 * @since 0.1.0
 * @see {@link ConflictResolver}
 * @group Types
 */
export interface ConflictResolverConfigInterface {
  /**
   * What to do when proposals tie on priority across distinct class names.
   *
   * - `'quarantine'` — write a quarantine record under bucket `'conflicts'`
   *   and leave `state.classification` null.
   * - `'pickPriority'` — deterministically break the tie by picking the
   *   className that sorts first lexicographically; `candidates` on the
   *   resulting evidence lists all tied classNames.
   */
  readonly onConflict: 'quarantine' | 'pickPriority';

  /**
   * What to do when no class proposal exists after filtering sentinels.
   *
   * - `'quarantine'` — write a quarantine record under bucket `'unknown'`.
   * - `'skip'` — leave `state.classification` null and continue.
   */
  readonly onUnknown: 'quarantine' | 'skip';

  /**
   * Whether to preserve the full proposal trail in the final
   * {@link ClassificationEvidenceInterface}.
   *
   * When `true`, `reasons` on the evidence object concatenates all reasons
   * from every contributing proposal in order. When `false`, only the top
   * reason from the winning proposal is included.
   */
  readonly evidence: boolean;
}

// ── Metadata sentinels ────────────────────────────────────────────────────────

/**
 * Set of className sentinels filtered out before conflict resolution.
 * These are coordination tokens, not class votes.
 *
 * @internal
 */
const METADATA_SENTINELS = new Set<string>(['__source__', '__validation__', '__narrowing_applied__', 'unknown']);

// ── ConflictResolver ──────────────────────────────────────────────────────────

/**
 * Pipeline task that resolves accumulated classification proposals to a single
 * winning class and writes the result to `state.classification`.
 *
 * @remarks
 * The resolver reads all proposals on `state.classifications`, filters out
 * metadata sentinels, and applies the configured resolution policy. It always
 * calls `next()` — quarantine is a graceful side-effect, not an error throw.
 *
 * @example
 * ```ts
 * const resolver = new ConflictResolver(
 *   { onConflict: 'quarantine', onUnknown: 'skip', evidence: true },
 *   './graphs',
 *   'aonprd',
 * );
 * registry.register('classify:conflict', resolver.execute);
 * ```
 *
 * @category Classification
 * @since 0.1.0
 * @see {@link ConflictResolverConfigInterface}
 * @see {@link ClassificationEvidenceInterface}
 * @group Classifiers
 */
export class ConflictResolver {
  /** Frozen resolution policy. */
  readonly #config:   ConflictResolverConfigInterface;
  /** Run output root directory; quarantine records land under `<outDir>/<targetId>/quarantine/`. */
  readonly #outDir:   string;
  /** Target identifier used for quarantine attribution. */
  readonly #targetId: string;

  /**
   * Creates a {@link ConflictResolver} instance.
   *
   * @remarks
   * Validates that `outDir` and `targetId` are non-empty strings. Empty values
   * indicate a misconfigured pipeline and fail fast at construction time.
   *
   * @param config   - Resolution policy.
   * @param outDir   - Run output directory; quarantine writes here.
   * @param targetId - Target identifier; quarantine attribution.
   * @throws {OutputConfigError} When `outDir` or `targetId` is empty.
   */
  public constructor(
    config:   ConflictResolverConfigInterface,
    outDir:   string,
    targetId: string,
  ) {
    if (!outDir || !targetId) {
      throw OutputConfigError.create(
        'ConflictResolver requires non-empty outDir and targetId.',
        { metadata: { task: 'classify:conflict', outDir, targetId } },
      );
    }

    this.#config   = Object.freeze({ ...config });
    this.#outDir   = outDir;
    this.#targetId = targetId;

    // Bind execute so it can be passed as a bare function reference to
    // TaskRegistry.register() without losing its `this` context.
    this.execute = this.#executeImpl.bind(this);
  }

  /**
   * Bound pipeline task function for `classify:conflict`.
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
    logger.debug('execute', 'ConflictResolver invoked', {
      targetId:      state.targetId,
      proposalCount: state.classifications.length,
    });

    // Step 1: filter out metadata sentinels — they are coordination tokens.
    const candidates = state.classifications.filter(
      (p) => !METADATA_SENTINELS.has(p.className),
    );

    // Step 2: no real proposals → apply onUnknown policy.
    if (candidates.length === 0) {
      await this.#handleUnknown(state);
      await next();
      return;
    }

    // Step 3: gather the distinct class names in the proposal set.
    const classNames = new Set<string>(candidates.map((p) => p.className));

    if (classNames.size === 1) {
      // All proposals agree — single winner (possibly multiple corroborations).
      const winner = this.#pickHighestPriority(candidates);
      const evidence = this.#buildEvidence(winner.className, candidates, undefined);
      (state as unknown as { classification: ClassificationEvidenceInterface | null })
        .classification = evidence;

      logger.info('execute', 'Classification resolved (single class)', {
        targetId:  state.targetId,
        className: winner.className,
        engine:    evidence.engine,
      });

      await next();
      return;
    }

    // Step 4: multi-class conflict — find the class(es) with the highest priority.
    const maxPriority = Math.max(...candidates.map((p) => p.priority));
    const topProposals = candidates.filter((p) => p.priority === maxPriority);
    const topClassNames = [...new Set<string>(topProposals.map((p) => p.className))];

    if (topClassNames.length === 1) {
      // Clear winner by priority — no genuine tie.
      const winnerClass = topClassNames[0] as string;
      const winnerProposals = candidates.filter((p) => p.className === winnerClass);
      const evidence = this.#buildEvidence(winnerClass, winnerProposals, undefined);
      (state as unknown as { classification: ClassificationEvidenceInterface | null })
        .classification = evidence;

      logger.info('execute', 'Classification resolved (priority winner)', {
        targetId:  state.targetId,
        className: winnerClass,
        engine:    evidence.engine,
      });

      await next();
      return;
    }

    // Genuine tie: ≥2 distinct classes share the highest priority.
    const tiedClassNames = topClassNames.sort();

    if (this.#config.onConflict === 'quarantine') {
      await this.#handleConflict(state, tiedClassNames);
    } else {
      // pickPriority: lexicographically first wins, candidates lists all tied.
      const winnerClass = tiedClassNames[0] as string;
      const winnerProposals = candidates.filter((p) => p.className === winnerClass);
      const evidence = this.#buildEvidence(winnerClass, winnerProposals, tiedClassNames);
      (state as unknown as { classification: ClassificationEvidenceInterface | null })
        .classification = evidence;

      logger.info('execute', 'Classification resolved (lex tiebreak)', {
        targetId:    state.targetId,
        className:   winnerClass,
        tiedClasses: tiedClassNames,
        engine:      evidence.engine,
      });
    }

    await next();
  }

  // ── Resolution helpers ────────────────────────────────────────────────────

  /**
   * Returns the proposal with the highest `priority` from `proposals`.
   *
   * @remarks
   * When multiple proposals share the highest priority (same className,
   * multiple corroborating sources), the first one in array order is returned
   * — all carry the same class, so the tiebreak is irrelevant for confidence.
   *
   * @param proposals - Non-empty, pre-filtered proposal list (sentinels removed).
   * @returns The highest-priority proposal.
   */
  #pickHighestPriority(proposals: ReadonlyArray<ClassificationProposalInterface>): ClassificationProposalInterface {
    let winner = proposals[0] as ClassificationProposalInterface;

    for (let i = 1; i < proposals.length; i++) {
      const p = proposals[i] as ClassificationProposalInterface;
      if (p.priority > winner.priority) {
        winner = p;
      }
    }

    return winner;
  }

  /**
   * Builds a {@link ClassificationEvidenceInterface} from the winning class
   * and the proposals that support it.
   *
   * @param className      - The winning class name.
   * @param proposals      - All proposals for the winning class (used for engine + reasons).
   * @param tiedClassNames - Sorted list of tied classNames (only present on lex tiebreak).
   * @returns Fully populated evidence object.
   */
  #buildEvidence(
    className:      string,
    proposals:      ReadonlyArray<ClassificationProposalInterface>,
    tiedClassNames: ReadonlyArray<string> | undefined,
  ): ClassificationEvidenceInterface {
    const winner    = this.#pickHighestPriority(proposals);
    const sources   = [...new Set<string>(proposals.map((p) => p.source))];
    const engine    = sources.join(',');

    const reasons: ReadonlyArray<string> = this.#config.evidence
      ? proposals.flatMap((p) => [...p.reasons])
      : [winner.reasons[0] ?? winner.className];

    return {
      type:       className,
      confidence: winner.confidence,
      engine,
      reasons,
      candidates: tiedClassNames,
    };
  }

  /**
   * Handles the `onUnknown` policy: quarantine or skip.
   *
   * @param state - Current pipeline state; used for quarantine record fields.
   */
  async #handleUnknown(state: PipelineStateInterface): Promise<void> {
    if (this.#config.onUnknown !== 'quarantine') {
      logger.debug('execute', 'No proposals; skip policy applied', {
        targetId: state.targetId,
      });
      return;
    }

    const id = createHash('sha1')
      .update(`${state.source.path}#${state.classifications.length}`)
      .digest('hex');

    const writer = QuarantineWriter.forRun(this.#outDir, this.#targetId);
    await writer.write({
      id,
      target:         state.source.target,
      bucket:         'unknown',
      source:         state.source,
      input:          state.input,
      classification: null,
      timestamp:      new Date().toISOString(),
    });

    logger.info('execute', 'Record quarantined (no class proposals)', {
      targetId: state.targetId,
      id,
    });
  }

  /**
   * Handles a genuine tie under the `quarantine` conflict policy: writes a
   * quarantine record under bucket `'conflicts'` and leaves
   * `state.classification` null.
   *
   * @param state          - Current pipeline state.
   * @param tiedClassNames - Sorted array of all tied class names.
   */
  async #handleConflict(
    state:          PipelineStateInterface,
    tiedClassNames: ReadonlyArray<string>,
  ): Promise<void> {
    const id = createHash('sha1')
      .update(`${state.source.path}#${state.classifications.length}`)
      .digest('hex');

    const writer = QuarantineWriter.forRun(this.#outDir, this.#targetId);
    await writer.write({
      id,
      target:         state.source.target,
      bucket:         'conflicts',
      source:         state.source,
      input:          state.input,
      classification: null,
      candidates:     tiedClassNames.map((className) => ({
        type:       className,
        confidence: 1,
        engine:     'classify:conflict',
        reasons:    [`tied-class: ${className}`],
      })),
      timestamp: new Date().toISOString(),
    });

    logger.info('execute', 'Record quarantined (conflict tie)', {
      targetId:    state.targetId,
      id,
      tiedClasses: tiedClassNames,
    });
  }
}

// ── Plugin self-registration (silo migration, task #17) ───────────────────────

/**
 * AJV schema fragment for `config.conflict` (the per-plugin config namespace
 * consumed by the `classify:conflict` `onRunStart` hook).
 *
 * @remarks
 * Mirrors the `conflict` sub-schema in `SquashageConfig` so the per-plugin
 * validation performed at `onRunStart` matches the cross-target-config check.
 * Exported so other plugins (and future config-aggregation tooling) may
 * compose it; not part of the silo contract.
 *
 * @category Classification
 * @since 0.7.0
 * @group Schema
 */
export const CONFLICT_CONFIG_SCHEMA = {
  type:                 'object',
  additionalProperties: false,
  required:             ['onConflict', 'onUnknown', 'evidence'],
  properties: {
    onConflict: { type: 'string', enum: ['quarantine', 'pickPriority'] as const },
    onUnknown:  { type: 'string', enum: ['quarantine', 'skip'] as const },
    evidence:   { type: 'boolean' },
  },
} as const;

/**
 * Per-context cached resolver state captured at `onRunStart`.
 *
 * @remarks
 * Holds the resolution policy (validated against {@link CONFLICT_CONFIG_SCHEMA})
 * plus the silo-derived `outDir` / `target` snapshot. Captured here at
 * `onRunStart` so the per-record task can build a {@link QuarantineWriter}
 * without re-reading the silo on every record. The amendment-A3 invariant —
 * "the quarantine path is computed from silo values at `onRunStart`, not from
 * constructor args" — is enforced by this cache.
 *
 * @internal
 */
interface ConflictResolverRunStateInterface {
  readonly config: ConflictResolverConfigInterface;
  readonly outDir: string;
  readonly target: string;
}

/**
 * Per-context cache of resolver run-state.
 *
 * @remarks
 * Populated by the `classify:conflict` `onRunStart` hook from
 * `ctx.config.conflict`, `ctx.outDir`, and `ctx.target`; consumed by the
 * `classify:conflict` per-record task. Keyed by the
 * {@link PipelineContextInterface} object so concurrent runs in the same
 * process do not collide. The WeakMap lets the cache release as soon as the
 * run-context goes out of scope.
 *
 * @internal
 */
const runStateByContext: WeakMap<
  PipelineContextInterface,
  ConflictResolverRunStateInterface
> = new WeakMap();

/**
 * `onRunStart` hook for `classify:conflict`.
 *
 * @remarks
 * 1. Reads `ctx.config.conflict` (per-plugin namespace per the silo contract).
 *    No-ops when absent so the plugin is safe to import in pipelines that do
 *    not use conflict resolution.
 * 2. AJV-compiles {@link CONFLICT_CONFIG_SCHEMA} via the run-wide `ctx.ajv`
 *    and fails fast with {@link OutputConfigError} when validation fails.
 * 3. Reads `ctx.outDir` + `ctx.target` from the silo and caches them
 *    alongside the validated config in {@link runStateByContext} keyed by
 *    `ctx`. Per the silo contract these are populated by the orchestrator
 *    BEFORE any `onRunStart` hook runs, so they are guaranteed present.
 *    Empty values fail fast — a misconfigured pipeline must not silently
 *    write quarantine records to an unknown path.
 *
 * @internal
 */
function conflictOnRunStart(ctx: PipelineContextInterface): void {
  const rawConfig = (ctx.config as Readonly<Record<string, unknown>>)['conflict'];
  if (rawConfig === undefined) {
    logger.debug('onRunStart', 'no classify:conflict config; hook left dormant', { target: ctx.target });
    return;
  }

  const validate: ValidateFunction = ctx.ajv.compile(CONFLICT_CONFIG_SCHEMA);
  if (!validate(rawConfig)) {
    const errors = validate.errors ?? [];
    throw OutputConfigError.create(
      `classify:conflict: invalid config.conflict — ${errors.map(e => `${e.instancePath} ${e.message ?? ''}`).join('; ')}`,
      { metadata: { target: ctx.target, errors: errors as unknown as Record<string, unknown>[] } },
    );
  }

  if (!ctx.outDir || !ctx.target) {
    throw OutputConfigError.create(
      'classify:conflict requires non-empty ctx.outDir and ctx.target.',
      { metadata: { task: 'classify:conflict', outDir: ctx.outDir, target: ctx.target } },
    );
  }

  const config = Object.freeze({ ...(rawConfig as ConflictResolverConfigInterface) });
  runStateByContext.set(ctx, Object.freeze({
    config,
    outDir: ctx.outDir,
    target: ctx.target,
  }));

  logger.info('onRunStart', 'classify:conflict armed', {
    target:     ctx.target,
    outDir:     ctx.outDir,
    onConflict: config.onConflict,
    onUnknown:  config.onUnknown,
  });
}

/**
 * Per-record task function for `classify:conflict`.
 *
 * @remarks
 * Reads the cached run-state populated at `onRunStart` (validated config plus
 * silo-derived outDir/target snapshot). When no run-state was cached (because
 * `ctx.config.conflict` was absent), the task no-ops and chains to `next` —
 * the pipeline is permitted to include `classify:conflict` even when no
 * conflict configuration is defined.
 *
 * Resolution logic mirrors {@link ConflictResolver.execute} verbatim; the only
 * difference between the two paths is how the run-time inputs (config + outDir
 * + target) reach the task — constructor args (legacy) vs. silo snapshot
 * (this plugin).
 *
 * @internal
 */
const conflictTask: TaskFnInterface<PipelineStateInterface> = async (
  next:  NextFnInterface,
  state: PipelineStateInterface,
): Promise<void> => {
  const ctx       = state.context;
  const runState  = ctx !== undefined ? runStateByContext.get(ctx) : undefined;

  if (runState === undefined) {
    logger.debug('execute', 'classify:conflict cache empty; no resolution performed', {
      targetId: state.targetId,
    });
    await next();
    return;
  }

  logger.debug('execute', 'classify:conflict invoked', {
    targetId:      state.targetId,
    proposalCount: state.classifications.length,
  });

  // Step 1: filter out metadata sentinels — they are coordination tokens.
  const candidates = state.classifications.filter(
    (p) => !METADATA_SENTINELS.has(p.className),
  );

  // Step 2: no real proposals → apply onUnknown policy.
  if (candidates.length === 0) {
    if (runState.config.onUnknown === 'quarantine') {
      const id = createHash('sha1')
        .update(`${state.source.path}#${state.classifications.length}`)
        .digest('hex');

      const writer = QuarantineWriter.forRun(runState.outDir, runState.target);
      await writer.write({
        id,
        target:         state.source.target,
        bucket:         'unknown',
        source:         state.source,
        input:          state.input,
        classification: null,
        timestamp:      new Date().toISOString(),
      });

      logger.info('execute', 'Record quarantined (no class proposals)', {
        targetId: state.targetId,
        id,
      });
    } else {
      logger.debug('execute', 'No proposals; skip policy applied', {
        targetId: state.targetId,
      });
    }
    await next();
    return;
  }

  // Step 3: gather the distinct class names in the proposal set.
  const classNames = new Set<string>(candidates.map((p) => p.className));

  if (classNames.size === 1) {
    const winnerProposals = candidates;
    const evidence        = buildEvidence(
      runState.config,
      (winnerProposals[0] as ClassificationProposalInterface).className,
      winnerProposals,
      undefined,
    );
    (state as unknown as { classification: ClassificationEvidenceInterface | null })
      .classification = evidence;

    logger.info('execute', 'Classification resolved (single class)', {
      targetId:  state.targetId,
      className: evidence.type,
      engine:    evidence.engine,
    });

    await next();
    return;
  }

  // Step 4: multi-class conflict — find the class(es) with the highest priority.
  const maxPriority   = Math.max(...candidates.map((p) => p.priority));
  const topProposals  = candidates.filter((p) => p.priority === maxPriority);
  const topClassNames = [...new Set<string>(topProposals.map((p) => p.className))];

  if (topClassNames.length === 1) {
    const winnerClass     = topClassNames[0] as string;
    const winnerProposals = candidates.filter((p) => p.className === winnerClass);
    const evidence        = buildEvidence(runState.config, winnerClass, winnerProposals, undefined);
    (state as unknown as { classification: ClassificationEvidenceInterface | null })
      .classification = evidence;

    logger.info('execute', 'Classification resolved (priority winner)', {
      targetId:  state.targetId,
      className: winnerClass,
      engine:    evidence.engine,
    });

    await next();
    return;
  }

  // Genuine tie: ≥2 distinct classes share the highest priority.
  const tiedClassNames = topClassNames.sort();

  if (runState.config.onConflict === 'quarantine') {
    const id = createHash('sha1')
      .update(`${state.source.path}#${state.classifications.length}`)
      .digest('hex');

    const writer = QuarantineWriter.forRun(runState.outDir, runState.target);
    await writer.write({
      id,
      target:         state.source.target,
      bucket:         'conflicts',
      source:         state.source,
      input:          state.input,
      classification: null,
      candidates:     tiedClassNames.map((className) => ({
        type:       className,
        confidence: 1,
        engine:     'classify:conflict',
        reasons:    [`tied-class: ${className}`],
      })),
      timestamp: new Date().toISOString(),
    });

    logger.info('execute', 'Record quarantined (conflict tie)', {
      targetId:    state.targetId,
      id,
      tiedClasses: tiedClassNames,
    });
  } else {
    // pickPriority: lexicographically first wins, candidates lists all tied.
    const winnerClass     = tiedClassNames[0] as string;
    const winnerProposals = candidates.filter((p) => p.className === winnerClass);
    const evidence        = buildEvidence(runState.config, winnerClass, winnerProposals, tiedClassNames);
    (state as unknown as { classification: ClassificationEvidenceInterface | null })
      .classification = evidence;

    logger.info('execute', 'Classification resolved (lex tiebreak)', {
      targetId:    state.targetId,
      className:   winnerClass,
      tiedClasses: tiedClassNames,
      engine:      evidence.engine,
    });
  }

  await next();
};

/**
 * Returns the proposal with the highest `priority` from `proposals`.
 *
 * @remarks
 * Free helper used by the plugin path. When multiple proposals share the
 * highest priority (same className, multiple corroborating sources), the first
 * one in array order is returned — all carry the same class, so the tiebreak
 * is irrelevant for confidence. Mirrors `ConflictResolver.#pickHighestPriority`.
 *
 * @internal
 */
function pickHighestPriority(
  proposals: ReadonlyArray<ClassificationProposalInterface>,
): ClassificationProposalInterface {
  let winner = proposals[0] as ClassificationProposalInterface;
  for (let i = 1; i < proposals.length; i++) {
    const p = proposals[i] as ClassificationProposalInterface;
    if (p.priority > winner.priority) {
      winner = p;
    }
  }
  return winner;
}

/**
 * Builds a {@link ClassificationEvidenceInterface} from the winning class and
 * the proposals that support it. Mirrors {@link ConflictResolver.#buildEvidence}.
 *
 * @internal
 */
function buildEvidence(
  config:         ConflictResolverConfigInterface,
  className:      string,
  proposals:      ReadonlyArray<ClassificationProposalInterface>,
  tiedClassNames: ReadonlyArray<string> | undefined,
): ClassificationEvidenceInterface {
  const winner  = pickHighestPriority(proposals);
  const sources = [...new Set<string>(proposals.map((p) => p.source))];
  const engine  = sources.join(',');

  const reasons: ReadonlyArray<string> = config.evidence
    ? proposals.flatMap((p) => [...p.reasons])
    : [winner.reasons[0] ?? winner.className];

  return {
    type:       className,
    confidence: winner.confidence,
    engine,
    reasons,
    candidates: tiedClassNames,
  };
}

TaskRegistry.registerHook('classify:conflict', 'onRunStart', conflictOnRunStart);
TaskRegistry.register('classify:conflict', conflictTask);
