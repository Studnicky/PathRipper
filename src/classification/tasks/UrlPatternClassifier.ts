/**
 * @fileoverview `classify:url-pattern` pipeline task -- URL-regex classifier.
 *
 * @remarks
 * Two coexisting registration paths during the v0.7.0 silo migration:
 *
 * 1. **Legacy factory path (still active).** The `ClassificationFactory` calls
 *    {@link UrlPatternClassifier.create} to build a classifier instance eagerly
 *    from `classification.urlPattern`, and the orchestrator registers
 *    `instance.execute` onto the per-run `TaskRegistry`. Regex compilation
 *    happens at `create()` time; the per-record path is pure CPU.
 *
 * 2. **Self-registering plugin path (this module's top-level).** At import
 *    time the module side-effect-registers two entries on the global
 *    `TaskRegistry`:
 *
 *    - `TaskRegistry.register('classify:url-pattern', task, { proposesClass: true })`
 *      installs the per-record task. The task reads its compiled patterns from
 *      a module-level cache keyed by `ctx.target`.
 *    - `TaskRegistry.registerHook('classify:url-pattern', 'onRunStart', hook,
 *      { proposesClass: true })` installs the lifecycle hook. The hook validates
 *      `ctx.config.urlPattern` against {@link urlPatternConfigSchema} via
 *      `ctx.ajv`, compiles each `patterns[i].match` source string into a
 *      `RegExp`, and writes the compiled list into the cache. An invalid regex
 *      throws `OutputConfigError` naming the zero-based pattern index, mirroring
 *      the legacy fail-fast semantics.
 *
 * The cache is keyed by `ctx.target` so concurrent runs with disjoint targets
 * never see each other's patterns. The per-record task fails fast with
 * `OutputConfigError` if the cache is missing for `state.targetId` -- this
 * happens only when the orchestrator has not driven the `onRunStart` hook for
 * the current target before per-record dispatch (a bug the silo migration
 * orchestrator wiring task is responsible for catching).
 *
 * Per the silo contract, a pattern match emits one
 * {@link ClassificationProposalInterface} per matching pattern, with
 * `source: 'classify:url-pattern'` and the regex source plus matched URL in the
 * `reasons` array. Multiple patterns may match a single URL; the
 * `ConflictResolver` downstream handles disambiguation.
 *
 * @module
 * @since 0.5.0
 * @category Classification
 */

import type { NextFnInterface, TaskFnInterface } from '../../types/Pipeline.js';
import type {
  PipelineContextInterface,
  PipelineStateInterface,
  ClassificationProposalInterface,
} from '../../types/PipelineState.js';
import { OutputConfigError } from '../../errors/OutputConfigError.js';
import { TaskRegistry }      from '../../registry/TaskRegistry.js';
import { Logger }            from '../../modules/logger/logger.js';

const logger = Logger.forComponent('UrlPatternClassifier');

// ── Config interfaces ──────────────────────────────────────────────────────────

/**
 * A single URL-pattern entry as it appears in the target config's
 * `classification.urlPattern.patterns[]` array (or `urlPattern.patterns[]`
 * under the silo path).
 *
 * @category Classification
 * @since 0.5.0
 * @group Types
 */
export interface UrlPatternEntryInterface {
  /** Ontology class id proposed when the pattern matches the record URL. */
  readonly className: string;
  /** Regex source string; compiled once at config load. */
  readonly match:     string;
  /** Numeric priority forwarded onto the emitted proposal. Defaults to 35. */
  readonly priority?: number | undefined;
}

/**
 * Configuration block for {@link UrlPatternClassifier}.
 *
 * @category Classification
 * @since 0.5.0
 * @group Types
 */
export interface UrlPatternConfigInterface {
  /** At least one pattern must be present. */
  readonly patterns: ReadonlyArray<UrlPatternEntryInterface>;
}

// ── AJV config schema fragment ─────────────────────────────────────────────────

/**
 * AJV-compatible JSON Schema fragment for the `urlPattern` config namespace.
 *
 * @remarks
 * Compiled by the plugin's `onRunStart` hook against `ctx.ajv` to validate
 * `ctx.config.urlPattern`. Identical in shape to the
 * `classification.urlPattern` sub-schema in `SquashageConfig.ts`, but lives
 * here so the plugin owns its own validation under the silo contract.
 *
 * @category Classification
 * @since 0.7.0
 * @group Schemas
 */
export const urlPatternConfigSchema = {
  type:                 'object',
  additionalProperties: false,
  required:             ['patterns'],
  properties: {
    patterns: {
      type:     'array',
      minItems: 1,
      items: {
        type:                 'object',
        additionalProperties: false,
        required:             ['className', 'match'],
        properties: {
          className: { type: 'string', minLength: 1 },
          match:     { type: 'string', minLength: 1 },
          priority:  { type: 'integer', minimum: 0 },
        },
      },
    },
  },
} as const;

// ── Compiled pattern type ──────────────────────────────────────────────────────

/** A pre-compiled pattern ready for per-record evaluation. */
interface CompiledPatternInterface {
  readonly className: string;
  readonly priority:  number;
  readonly regex:     RegExp;
  /** Pre-computed reason string for the regex to avoid interpolation on the hot path. */
  readonly reason:    string;
}

// ── Bridge interface (silo migration; internal) ────────────────────────────────

/**
 * Bridge slot the orchestrator writes onto `ctx.config` so plugins can read
 * the raw `urlPattern` block from the typed silo without losing strictness.
 *
 * @internal
 */
interface CtxConfigBridgeInterface {
  readonly urlPattern?: unknown;
}

// ── Module-level compiled-pattern cache (silo path) ────────────────────────────

/**
 * Cache of compiled patterns keyed by `ctx.target`.
 *
 * @remarks
 * Populated by the `onRunStart` hook; read by the per-record task. Distinct
 * targets in the same process see disjoint entries, so concurrent runs cannot
 * cross-contaminate each other's compiled regexes.
 *
 * @internal
 */
const compiledCache = new Map<string, ReadonlyArray<CompiledPatternInterface>>();

// ── Pure compile helper (shared by both registration paths) ────────────────────

/**
 * Compiles each `patterns[i].match` into a `RegExp`.
 *
 * @throws {OutputConfigError} When any `match` string is an invalid regex,
 *   naming the zero-based pattern index.
 */
function compilePatterns(
  config: UrlPatternConfigInterface,
): ReadonlyArray<CompiledPatternInterface> {
  const compiled: CompiledPatternInterface[] = config.patterns.map((entry, idx) => {
    let regex: RegExp;
    try {
      regex = new RegExp(entry.match);
    } catch (err) {
      const cause = err instanceof Error ? err : undefined;
      throw OutputConfigError.create(
        `classify:url-pattern: invalid regex at patterns[${idx.toString()}].match "${entry.match}": ${cause?.message ?? String(err)}`,
        { cause, metadata: { patternIndex: idx, match: entry.match } },
      );
    }
    return {
      className: entry.className,
      priority:  entry.priority ?? 35,
      regex,
      reason:    `url-pattern: ${entry.match}`,
    };
  });

  return Object.freeze(compiled);
}

// ── Pure URL extractor (shared by both registration paths) ─────────────────────

/**
 * Extracts the URL string from the input record.
 *
 * @remarks
 * Reads `_source.url` first (squashage-enriched form). Falls back to the
 * top-level `url` field (raw scrape form). Returns `undefined` when neither
 * is a non-empty string.
 *
 * @param input - Parsed input JSON record from `state.input`.
 * @returns The URL string, or `undefined` when absent.
 */
function extractUrl(input: Readonly<Record<string, unknown>>): string | undefined {
  // Prefer _source.url (squashage-enriched).
  const sourceBlock = input['_source'];
  if (sourceBlock !== null && typeof sourceBlock === 'object' && !Array.isArray(sourceBlock)) {
    const src = sourceBlock as Record<string, unknown>;
    if (typeof src['url'] === 'string' && src['url'].length > 0) {
      return src['url'];
    }
  }

  // Fallback: top-level url.
  if (typeof input['url'] === 'string' && input['url'].length > 0) {
    return input['url'];
  }

  return undefined;
}

// ── Pure scoring helper (shared by both registration paths) ────────────────────

/**
 * Evaluates compiled patterns against a record and pushes matching proposals
 * onto `state.classifications`.
 *
 * @param targetId - Squashage target id, for log scope only.
 * @param patterns - Pre-compiled pattern list.
 * @param state    - Mutable per-record pipeline state.
 */
function runUrlPatternScoring(
  targetId: string,
  patterns: ReadonlyArray<CompiledPatternInterface>,
  state:    PipelineStateInterface,
): void {
  const url = extractUrl(state.input);

  if (url === undefined) {
    logger.debug('execute', 'No URL found on record; emitting no proposals', { targetId });
    return;
  }

  const newProposals: ClassificationProposalInterface[] = [];

  for (const pattern of patterns) {
    if (pattern.regex.test(url)) {
      newProposals.push({
        source:     'classify:url-pattern',
        className:  pattern.className,
        priority:   pattern.priority,
        confidence: 1,
        reasons:    [pattern.reason, `url=${url}`],
      });
    }
  }

  if (newProposals.length > 0) {
    (state as unknown as { classifications: ReadonlyArray<ClassificationProposalInterface> })
      .classifications = [...state.classifications, ...newProposals];

    logger.info('execute', 'URL-pattern proposals emitted', {
      targetId,
      url,
      proposalCount: newProposals.length,
    });
  } else {
    logger.debug('execute', 'No URL patterns matched', { targetId, url });
  }
}

// ── UrlPatternClassifier ───────────────────────────────────────────────────────

/**
 * Classifier task that emits URL-pattern proposals.
 *
 * @remarks
 * Each configured pattern is compiled to a `RegExp` once at construction time.
 * On each record, the classifier extracts the URL from `_source.url` (priority)
 * or top-level `url` (fallback). When neither is present, no proposal is emitted.
 *
 * For each pattern whose regex matches the URL, one proposal is pushed onto
 * `state.classifications` with:
 * - `source: 'classify:url-pattern'`
 * - `className`: from config
 * - `priority`: from config (default 35)
 * - `engine: 'url-pattern'` in the `reasons` array
 * - `url=<matched url>` in the `reasons` array
 *
 * @example
 * ```ts
 * const classifier = UrlPatternClassifier.create({
 *   patterns: [
 *     { className: 'feat',  match: '/Feats\\.aspx',  priority: 35 },
 *     { className: 'spell', match: '/Spells\\.aspx', priority: 35 },
 *   ],
 * });
 * registry.register('classify:url-pattern', classifier.execute);
 * ```
 *
 * @category Classification
 * @since 0.5.0
 * @see {@link UrlPatternConfigInterface}
 * @see {@link ClassificationProposalInterface}
 * @group Classifiers
 */
export class UrlPatternClassifier {
  /** Frozen compiled-pattern list; evaluated per-record on the hot path. */
  readonly #patterns: ReadonlyArray<CompiledPatternInterface>;

  private constructor(patterns: ReadonlyArray<CompiledPatternInterface>) {
    this.#patterns = Object.freeze([...patterns]);
    // Bind execute so it can be passed as a bare function reference to
    // TaskRegistry.register() without losing its `this` context.
    this.execute = this.#executeImpl.bind(this);
  }

  /**
   * Creates a {@link UrlPatternClassifier} instance from raw config.
   *
   * @remarks
   * Each `match` string is compiled to a `RegExp` at call time. An invalid
   * regex source string at any index throws {@link OutputConfigError} immediately,
   * naming the zero-based pattern index so the user can locate it in their config.
   *
   * @param config - Raw URL-pattern config from the target's `classification.urlPattern` block.
   * @returns A fully constructed, ready-to-register classifier instance.
   * @throws {OutputConfigError} When any `match` string is an invalid regex, naming the pattern index.
   */
  public static create(config: UrlPatternConfigInterface): UrlPatternClassifier {
    const compiled = compilePatterns(config);
    return new UrlPatternClassifier(compiled);
  }

  /**
   * Bound pipeline task function for `classify:url-pattern`.
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
    logger.debug('execute', 'UrlPatternClassifier invoked', {
      targetId:     state.targetId,
      patternCount: this.#patterns.length,
    });

    runUrlPatternScoring(state.targetId, this.#patterns, state);

    await next();
  }
}

// ── Self-registering plugin (silo path) ────────────────────────────────────────

/**
 * Per-record task body for the silo path.
 *
 * @remarks
 * Reads its compiled patterns from the module-level cache, keyed by
 * `state.context?.target ?? state.targetId`. Fails fast with
 * `OutputConfigError` when no entry exists for the target -- this signals
 * that the orchestrator failed to drive the `onRunStart` hook for the
 * current target before per-record dispatch.
 */
const urlPatternTask: TaskFnInterface<PipelineStateInterface> = async (
  next:  NextFnInterface,
  state: PipelineStateInterface,
): Promise<void> => {
  const target = state.context?.target ?? state.targetId;
  const cached = compiledCache.get(target);
  if (cached === undefined) {
    throw OutputConfigError.create(
      `classify:url-pattern: no compiled patterns cached for target "${target}"; expected the onRunStart hook to populate the cache before per-record dispatch`,
      { metadata: { target } },
    );
  }

  runUrlPatternScoring(state.targetId, cached, state);

  await next();
};

TaskRegistry.register(
  'classify:url-pattern',
  urlPatternTask,
  { proposesClass: true },
);

TaskRegistry.registerHook(
  'classify:url-pattern',
  'onRunStart',
  (ctx: PipelineContextInterface): void => {
    const config         = ctx.config as Readonly<Record<string, unknown>> & CtxConfigBridgeInterface;
    const rawUrlPatternConfig = config.urlPattern;

    if (rawUrlPatternConfig === undefined) {
      logger.debug('onRunStart', 'no urlPattern config; skipping cache population', {
        target: ctx.target,
      });
      return;
    }

    // Validate the raw config block via the run-wide AJV instance.
    const validate = ctx.ajv.compile<UrlPatternConfigInterface>(urlPatternConfigSchema);
    if (!validate(rawUrlPatternConfig)) {
      throw OutputConfigError.create(
        `classify:url-pattern: invalid urlPattern config for target "${ctx.target}": ${ctx.ajv.errorsText(validate.errors)}`,
        { metadata: { target: ctx.target, errors: validate.errors } },
      );
    }

    const urlPatternConfig = rawUrlPatternConfig as UrlPatternConfigInterface;
    const compiled         = compilePatterns(urlPatternConfig);

    compiledCache.set(ctx.target, compiled);

    logger.debug('onRunStart', 'compiled url patterns cached', {
      target:       ctx.target,
      patternCount: compiled.length,
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
export function __resetUrlPatternCacheForTests(): void {
  compiledCache.clear();
}
