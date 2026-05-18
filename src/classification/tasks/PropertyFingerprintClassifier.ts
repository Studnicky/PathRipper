/**
 * @fileoverview `classify:property-fingerprint` pipeline task -- Jaccard-similarity
 * property-set fingerprint classifier.
 *
 * @remarks
 * Two coexisting registration paths during the v0.7.0 silo migration:
 *
 * 1. **Legacy factory path (still active).** The `ClassificationFactory` calls
 *    {@link PropertyFingerprintClassifier.create} to build a classifier instance
 *    eagerly from `classification.propertyFingerprint`, and the orchestrator
 *    registers `instance.execute` onto the per-run `TaskRegistry`. File I/O
 *    happens at `create()` time; the per-record path is pure CPU.
 *
 * 2. **Self-registering plugin path (this module's top-level).** At import
 *    time the module side-effect-registers two entries on the global
 *    `TaskRegistry`:
 *
 *    - `TaskRegistry.register('classify:property-fingerprint', task, { proposesClass: true })`
 *      installs the per-record task. The task reads its compiled fingerprints
 *      from a module-level cache keyed by `ctx.target`.
 *    - `TaskRegistry.registerHook('classify:property-fingerprint', 'onRunStart', hook)`
 *      installs the lifecycle hook. The hook validates `ctx.config.propertyFingerprint`
 *      against {@link propertyFingerprintConfigSchema} via `ctx.ajv`, resolves
 *      the fingerprints JSON file relative to `ctx.config.__schemasBase ??
 *      process.cwd()`, parses + pre-computes each entry into a frozen
 *      `Set<string>`, and writes the result into the cache.
 *
 * The cache is keyed by `ctx.target` so concurrent runs with disjoint targets
 * never see each other's fingerprints. The per-record task fails fast with
 * `OutputConfigError` if the cache is missing for `state.targetId` -- this
 * happens only when the orchestrator has not driven the `onRunStart` hook
 * for the current target before per-record dispatch (a bug the silo migration
 * orchestrator wiring task is responsible for catching).
 *
 * Per the silo contract, a fingerprint match emits one
 * {@link ClassificationProposalInterface} per fingerprint whose Jaccard
 * similarity meets or exceeds `minMatchScore`. Multiple fingerprints may match
 * a single record; the `ConflictResolver` downstream handles disambiguation.
 *
 * @module
 * @since 0.5.0
 * @category Classification
 */

import { readFileSync } from 'node:fs';
import { resolve }      from 'node:path';

import type { NextFnInterface, TaskFnInterface } from '../../types/Pipeline.js';
import type {
  ClassificationProposalInterface,
  PipelineContextInterface,
  PipelineStateInterface,
} from '../../types/PipelineState.js';
import { OutputConfigError } from '../../errors/OutputConfigError.js';
import { TaskRegistry }      from '../../registry/TaskRegistry.js';
import { Logger }            from '../../modules/logger/logger.js';

const logger = Logger.forComponent('PropertyFingerprintClassifier');

// ── Config interfaces ──────────────────────────────────────────────────────────

/**
 * A single entry in the fingerprints JSON file.
 *
 * @category Classification
 * @since 0.5.0
 * @group Types
 */
export interface FingerprintEntryInterface {
  /** Top-level property keys that characterise records of this class. */
  readonly keys:   ReadonlyArray<string>;
  /**
   * Informational weight stored in the file; currently not used in scoring
   * but preserved for future extension.
   */
  readonly weight?: number | undefined;
}

/**
 * Configuration block for {@link PropertyFingerprintClassifier}.
 *
 * @category Classification
 * @since 0.5.0
 * @group Types
 */
export interface PropertyFingerprintConfigInterface {
  /**
   * Filesystem path to the fingerprints JSON file. Resolved relative to:
   *
   * - the directory passed to {@link PropertyFingerprintClassifier.create}
   *   (legacy factory path), or
   * - `ctx.config.__schemasBase` (silo `onRunStart` path), falling back to
   *   `process.cwd()` when the bridge key is absent.
   */
  readonly fingerprintsFrom: string;
  /**
   * Minimum Jaccard similarity required to emit a proposal.
   * Must be in the range [0, 1]. Default: 0.85.
   */
  readonly minMatchScore?: number | undefined;
  /**
   * Numeric priority written onto every emitted proposal. Default: 32.
   */
  readonly priority?: number | undefined;
}

// ── AJV config schema fragment ─────────────────────────────────────────────────

/**
 * AJV-compatible JSON Schema fragment for the `propertyFingerprint` config
 * namespace.
 *
 * @remarks
 * Compiled by the plugin's `onRunStart` hook against `ctx.ajv` to validate
 * `ctx.config.propertyFingerprint`. Identical in shape to the
 * `classification.propertyFingerprint` sub-schema in `SquashageConfig.ts`,
 * but lives here so the plugin owns its own validation under the silo
 * contract.
 *
 * @category Classification
 * @since 0.7.0
 * @group Schemas
 */
export const propertyFingerprintConfigSchema = {
  type:                 'object',
  additionalProperties: false,
  required:             ['fingerprintsFrom'],
  properties: {
    fingerprintsFrom: { type: 'string', minLength: 1 },
    minMatchScore:    { type: 'number', minimum: 0, maximum: 1 },
    priority:         { type: 'integer', minimum: 0 },
  },
} as const;

// ── Compiled fingerprint type ──────────────────────────────────────────────────

/** A pre-computed fingerprint ready for per-record Jaccard evaluation. */
interface CompiledFingerprintInterface {
  readonly className: string;
  readonly priority:  number;
  readonly keySet:    ReadonlySet<string>;
}

/** Cached pre-computed fingerprint set for one target. */
interface CompiledCacheEntryInterface {
  readonly fingerprints:  ReadonlyArray<CompiledFingerprintInterface>;
  readonly minMatchScore: number;
}

// ── Bridge interface (silo migration; internal) ────────────────────────────────

/**
 * Bridge slots the orchestrator writes onto `ctx.config` so plugins can
 * resolve filesystem paths without re-doing the orchestrator's
 * `dirname(configPath)` calculation.
 *
 * @internal
 */
interface CtxConfigBridgeInterface {
  readonly __schemasBase?: string | undefined;
  readonly propertyFingerprint?: unknown;
}

// ── Module-level compiled-fingerprint cache (silo path) ────────────────────────

/**
 * Cache of compiled fingerprints keyed by `ctx.target`.
 *
 * @remarks
 * Populated by the `onRunStart` hook; read by the per-record task. Distinct
 * targets in the same process see disjoint entries, so concurrent runs cannot
 * cross-contaminate each other's fingerprint sets.
 *
 * @internal
 */
const compiledCache = new Map<string, CompiledCacheEntryInterface>();

// ── Pure compile helper (shared by both registration paths) ────────────────────

function compileFingerprints(
  fingerprintsFromAbsPath: string,
  fingerprintsFromRel:     string,
  priority:                number,
): ReadonlyArray<CompiledFingerprintInterface> {
  let text: string;
  try {
    text = readFileSync(fingerprintsFromAbsPath, 'utf-8');
  } catch (err) {
    const cause = err instanceof Error ? err : undefined;
    throw OutputConfigError.create(
      `classify:property-fingerprint: cannot read fingerprints file at ${fingerprintsFromAbsPath}: ${cause?.message ?? String(err)}`,
      { cause, metadata: { fingerprintsFrom: fingerprintsFromRel, absPath: fingerprintsFromAbsPath } },
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (err) {
    const cause = err instanceof Error ? err : undefined;
    throw OutputConfigError.create(
      `classify:property-fingerprint: cannot parse fingerprints JSON at ${fingerprintsFromAbsPath}: ${cause?.message ?? String(err)}`,
      { cause, metadata: { fingerprintsFrom: fingerprintsFromRel, absPath: fingerprintsFromAbsPath } },
    );
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw OutputConfigError.create(
      `classify:property-fingerprint: fingerprints file at ${fingerprintsFromAbsPath} must be a JSON object mapping className -> { keys, weight? }`,
      { metadata: { fingerprintsFrom: fingerprintsFromRel, absPath: fingerprintsFromAbsPath } },
    );
  }

  const rawMap = raw as Record<string, unknown>;
  const compiled: CompiledFingerprintInterface[] = [];

  for (const [className, entry] of Object.entries(rawMap)) {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      !('keys' in entry) ||
      !Array.isArray((entry as Record<string, unknown>)['keys'])
    ) {
      throw OutputConfigError.create(
        `classify:property-fingerprint: fingerprint entry "${className}" at ${fingerprintsFromAbsPath} must have a "keys" array`,
        { metadata: { className, absPath: fingerprintsFromAbsPath } },
      );
    }

    const keys = (entry as Record<string, unknown>)['keys'] as unknown[];

    if (keys.length === 0) {
      throw OutputConfigError.create(
        `classify:property-fingerprint: fingerprint entry "${className}" at ${fingerprintsFromAbsPath} has an empty "keys" array; at least one key is required`,
        { metadata: { className, absPath: fingerprintsFromAbsPath } },
      );
    }

    const keySet = new Set(keys.map(k => String(k)));

    compiled.push({
      className,
      priority,
      keySet: Object.freeze(keySet) as ReadonlySet<string>,
    });
  }

  return Object.freeze(compiled);
}

// ── PropertyFingerprintClassifier ──────────────────────────────────────────────

/**
 * Classifier task that evaluates Jaccard similarity over property key sets.
 *
 * @remarks
 * Each fingerprint's key set is pre-computed at construction time from the loaded
 * fingerprints JSON file. On each record the classifier:
 *
 * 1. Extracts the record's top-level property key set (top-level keys, sorted).
 * 2. For each pre-computed fingerprint computes `|A ∩ B| / |A ∪ B|`.
 * 3. Emits one proposal per fingerprint whose similarity >= `minMatchScore`.
 *
 * No file I/O occurs on the per-record path. The fingerprints file is read exactly
 * once during `PropertyFingerprintClassifier.create(config, configDir)` (legacy
 * factory path) or during the `onRunStart` lifecycle hook (silo path).
 *
 * @example
 * ```ts
 * const classifier = PropertyFingerprintClassifier.create(
 *   { fingerprintsFrom: './fingerprints.json', minMatchScore: 0.85, priority: 32 },
 *   path.dirname(configPath),
 * );
 * registry.register('classify:property-fingerprint', classifier.execute);
 * ```
 *
 * @category Classification
 * @since 0.5.0
 * @see {@link PropertyFingerprintConfigInterface}
 * @see {@link ClassificationProposalInterface}
 * @group Classifiers
 */
export class PropertyFingerprintClassifier {
  /** Frozen compiled-fingerprint list; evaluated per-record on the hot path. */
  readonly #fingerprints: ReadonlyArray<CompiledFingerprintInterface>;
  /** Minimum Jaccard similarity threshold. */
  readonly #minMatchScore: number;

  private constructor(
    fingerprints:  ReadonlyArray<CompiledFingerprintInterface>,
    minMatchScore: number,
  ) {
    this.#fingerprints  = Object.freeze([...fingerprints]);
    this.#minMatchScore = minMatchScore;
    // Bind execute so it can be passed as a bare function reference to
    // TaskRegistry.register() without losing its `this` context.
    this.execute = this.#executeImpl.bind(this);
  }

  /**
   * Creates a {@link PropertyFingerprintClassifier} instance from raw config.
   *
   * @remarks
   * The fingerprints JSON file is read and parsed synchronously once at call
   * time. Every fingerprint's key list is validated (non-empty) and pre-computed
   * into a `Set<string>` for O(1) intersection on the hot path.
   *
   * @param config    - Raw property-fingerprint config from the target's
   *   `classification.propertyFingerprint` block.
   * @param configDir - Directory of the squashage config file; used to resolve
   *   relative `fingerprintsFrom` paths.
   * @returns A fully constructed, ready-to-register classifier instance.
   * @throws {OutputConfigError} When the fingerprints file is missing, malformed,
   *   or any fingerprint entry has an empty `keys` array.
   */
  public static create(
    config:    PropertyFingerprintConfigInterface,
    configDir: string,
  ): PropertyFingerprintClassifier {
    const absPath       = resolve(configDir, config.fingerprintsFrom);
    const minMatchScore = config.minMatchScore ?? 0.85;
    const priority      = config.priority      ?? 32;

    const compiled = compileFingerprints(absPath, config.fingerprintsFrom, priority);

    logger.debug('create', 'PropertyFingerprintClassifier created', {
      absPath,
      fingerprintCount: compiled.length,
      minMatchScore,
      priority,
    });

    return new PropertyFingerprintClassifier(compiled, minMatchScore);
  }

  /**
   * Bound pipeline task function for `classify:property-fingerprint`.
   *
   * @remarks
   * Public class field; safe to pass as a bare reference to
   * {@link TaskRegistry.register} -- `this` binding is captured at
   * construction time.
   */
  public readonly execute: TaskFnInterface<PipelineStateInterface>;

  // ── Private implementation ──────────────────────────────────────────────────

  async #executeImpl(
    next:  NextFnInterface,
    state: PipelineStateInterface,
  ): Promise<void> {
    runFingerprintScoring({
      targetId:      state.targetId,
      input:         state.input,
      fingerprints:  this.#fingerprints,
      minMatchScore: this.#minMatchScore,
    }, state);
    await next();
  }
}

// ── Pure scoring helper (shared by both registration paths) ────────────────────

interface ScoringInputInterface {
  readonly targetId:      string;
  readonly input:         Readonly<Record<string, unknown>>;
  readonly fingerprints:  ReadonlyArray<CompiledFingerprintInterface>;
  readonly minMatchScore: number;
}

function runFingerprintScoring(
  scoring: ScoringInputInterface,
  state:   PipelineStateInterface,
): void {
  logger.debug('execute', 'PropertyFingerprintClassifier invoked', {
    targetId:         scoring.targetId,
    fingerprintCount: scoring.fingerprints.length,
  });

  const recordKeys = new Set(Object.keys(scoring.input));

  if (recordKeys.size === 0) {
    logger.debug('execute', 'Record has no top-level keys; emitting no proposals', {
      targetId: scoring.targetId,
    });
    return;
  }

  const newProposals: ClassificationProposalInterface[] = [];

  for (const fingerprint of scoring.fingerprints) {
    const score = jaccard(recordKeys, fingerprint.keySet);

    if (score >= scoring.minMatchScore) {
      const sharedCount = intersectionSize(recordKeys, fingerprint.keySet);
      newProposals.push({
        source:     'classify:property-fingerprint',
        className:  fingerprint.className,
        priority:   fingerprint.priority,
        confidence: score,
        reasons: [
          `fingerprint.score=${score.toFixed(2)}`,
          `fingerprint.shared=${sharedCount.toString()}`,
        ],
      });
    }
  }

  if (newProposals.length > 0) {
    (state as unknown as { classifications: ReadonlyArray<ClassificationProposalInterface> })
      .classifications = [...state.classifications, ...newProposals];

    logger.info('execute', 'Property-fingerprint proposals emitted', {
      targetId:      scoring.targetId,
      proposalCount: newProposals.length,
    });
  } else {
    logger.debug('execute', 'No fingerprints matched', {
      targetId:  scoring.targetId,
      keyCount:  recordKeys.size,
      threshold: scoring.minMatchScore,
    });
  }
}

/**
 * Computes Jaccard similarity between two key sets.
 *
 * @remarks
 * `|A ∩ B| / |A ∪ B|`. Returns 0 when both sets are empty.
 *
 * @param a - Record key set.
 * @param b - Fingerprint key set.
 * @returns Jaccard similarity in [0, 1].
 */
function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0;

  const intersect = intersectionSize(a, b);
  const union     = a.size + b.size - intersect;

  return union === 0 ? 0 : intersect / union;
}

/**
 * Counts the number of elements in the intersection of two sets.
 *
 * @param a - First set.
 * @param b - Second set (iterated).
 * @returns Count of elements present in both `a` and `b`.
 */
function intersectionSize(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let count = 0;
  for (const key of b) {
    if (a.has(key)) count++;
  }
  return count;
}

// ── Self-registering plugin (silo path) ────────────────────────────────────────

/**
 * Per-record task body for the silo path.
 *
 * @remarks
 * Reads its compiled fingerprints from the module-level cache, keyed by
 * `state.context?.target ?? state.targetId`. Fails fast with
 * `OutputConfigError` when no entry exists for the target -- this signals
 * that the orchestrator failed to drive the `onRunStart` hook for the
 * current target before per-record dispatch.
 */
const propertyFingerprintTask: TaskFnInterface<PipelineStateInterface> = async (
  next:  NextFnInterface,
  state: PipelineStateInterface,
): Promise<void> => {
  const target = state.context?.target ?? state.targetId;
  const cached = compiledCache.get(target);
  if (cached === undefined) {
    throw OutputConfigError.create(
      `classify:property-fingerprint: no compiled fingerprints cached for target "${target}"; expected the onRunStart hook to populate the cache before per-record dispatch`,
      { metadata: { target } },
    );
  }

  runFingerprintScoring({
    targetId:      state.targetId,
    input:         state.input,
    fingerprints:  cached.fingerprints,
    minMatchScore: cached.minMatchScore,
  }, state);

  await next();
};

TaskRegistry.register(
  'classify:property-fingerprint',
  propertyFingerprintTask,
  { proposesClass: true },
);

TaskRegistry.registerHook(
  'classify:property-fingerprint',
  'onRunStart',
  (ctx: PipelineContextInterface): void => {
    const config       = ctx.config as Readonly<Record<string, unknown>> & CtxConfigBridgeInterface;
    const rawFpConfig  = config.propertyFingerprint;

    if (rawFpConfig === undefined) {
      logger.debug('onRunStart', 'no propertyFingerprint config; skipping cache population', {
        target: ctx.target,
      });
      return;
    }

    // Validate the raw config block via the run-wide AJV instance.
    const validate = ctx.ajv.compile<PropertyFingerprintConfigInterface>(propertyFingerprintConfigSchema);
    if (!validate(rawFpConfig)) {
      throw OutputConfigError.create(
        `classify:property-fingerprint: invalid propertyFingerprint config for target "${ctx.target}": ${ctx.ajv.errorsText(validate.errors)}`,
        { metadata: { target: ctx.target, errors: validate.errors } },
      );
    }

    const fpConfig      = rawFpConfig as PropertyFingerprintConfigInterface;
    const minMatchScore = fpConfig.minMatchScore ?? 0.85;
    const priority      = fpConfig.priority      ?? 32;

    // Resolve the fingerprints file relative to the silo's schemasBase bridge
    // key, falling back to process.cwd() when the orchestrator has not threaded
    // the bridge value (e.g. tests that drive the hook directly).
    const baseDir = config.__schemasBase ?? process.cwd();
    const absPath = resolve(baseDir, fpConfig.fingerprintsFrom);

    const compiled = compileFingerprints(absPath, fpConfig.fingerprintsFrom, priority);

    compiledCache.set(ctx.target, { fingerprints: compiled, minMatchScore });

    logger.debug('onRunStart', 'compiled fingerprints cached', {
      target:           ctx.target,
      absPath,
      fingerprintCount: compiled.length,
      minMatchScore,
      priority,
    });
  },
  { proposesClass: true },
);

// ── Internal cache surface (test-only) ─────────────────────────────────────────

/**
 * Test-only cache reset.
 *
 * @remarks
 * Hook unit tests need a clean cache between cases. NOT part of the public
 * silo contract; do NOT call from production code.
 *
 * @internal
 */
export function __resetPropertyFingerprintCacheForTests(): void {
  compiledCache.clear();
}
