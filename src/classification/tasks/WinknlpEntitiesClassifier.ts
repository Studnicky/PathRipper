/**
 * @fileoverview `classify:winknlp-entities` pipeline task -- deterministic
 * pattern-based NER on prose fields via winkNLP custom entities.
 *
 * @remarks
 * Reads configured prose fields from each record, tokenizes the text with a
 * single shared `winkNLP` instance, and iterates matched custom entities.
 * For each match, one {@link ClassificationProposalInterface} is emitted with
 * `source: 'classify:winknlp-entities'` and a reasons array carrying the
 * pattern name, the matched text snippet, and the field name.
 *
 * The `winkNLP` model and all custom-entity patterns are compiled ONCE in the
 * constructor via {@link WinknlpEntitiesClassifier.create}; no model load or
 * pattern compile occurs on the hot per-record path.
 *
 * Invalid patterns (rejected by winkNLP's `learnCustomEntities`) are caught at
 * construction time and re-thrown as {@link OutputConfigError} naming the
 * offending pattern's `name` field.
 *
 * @module
 * @since 0.6.0
 * @category Classification
 */

import type { WinkMethods, CustomEntityExample, Detail } from 'wink-nlp';
import winkNlpModule from 'wink-nlp';
import modelModule   from 'wink-eng-lite-web-model';

import type { NextFnInterface, TaskFnInterface } from '../../types/Pipeline.js';
import type {
  PipelineContextInterface,
  PipelineStateInterface,
  ClassificationProposalInterface,
} from '../../types/PipelineState.js';
import { OutputConfigError } from '../../errors/OutputConfigError.js';
import { Logger }            from '../../modules/logger/logger.js';
import { TaskRegistry }      from '../../registry/TaskRegistry.js';

// CJS default interop (same pattern as AJV / ajv-formats throughout the codebase).
const winkNlp = (winkNlpModule as unknown as { default?: typeof winkNlpModule }).default
  ?? winkNlpModule;
const model = (modelModule as unknown as { default?: typeof modelModule }).default
  ?? modelModule;

const logger = Logger.forComponent('WinknlpEntitiesClassifier');

/** Maximum length (chars) of the matched-text snippet carried in a reason string. */
const MAX_SNIPPET_LENGTH = 80;

// ── Config interfaces ──────────────────────────────────────────────────────────

/**
 * A single winkNLP custom-entity pattern entry as it appears in the target
 * config's `classification.winknlpEntities.patterns[]` array.
 *
 * @category Classification
 * @since 0.6.0
 * @group Types
 */
export interface WinknlpPatternEntryInterface {
  /**
   * Unique pattern name -- passed as `name` to `learnCustomEntities` and
   * returned as `type` on each matched entity. Used to look up the
   * corresponding `className` and `priority` when a match fires.
   */
  readonly name:      string;
  /**
   * winkNLP pattern strings. Each string uses token literals (lower-case
   * words) and/or POS-tag / entity-type class brackets (e.g. `NOUN`,
   * `[ADJ]`, `CARDINAL`). Alternatives are expressed as
   * `[option1|option2]`.
   */
  readonly patterns:  ReadonlyArray<string>;
  /** Ontology class id proposed when this pattern fires. */
  readonly className: string;
  /** Numeric priority forwarded onto the emitted proposal. Default 28. */
  readonly priority?: number | undefined;
}

/**
 * Configuration block for {@link WinknlpEntitiesClassifier}.
 *
 * @category Classification
 * @since 0.6.0
 * @group Types
 */
export interface WinknlpEntitiesConfigInterface {
  /** At least one pattern group must be present. */
  readonly patterns: ReadonlyArray<WinknlpPatternEntryInterface>;
  /**
   * Prose field names to inspect on each record (default: `['description']`).
   * Fields absent on a record or with a non-string value are silently skipped.
   */
  readonly fields?:  ReadonlyArray<string> | undefined;
}

// ── Compiled lookup ────────────────────────────────────────────────────────────

/**
 * Pre-compiled per-pattern metadata used on the hot per-record path.
 * Keyed by the pattern `name` so the classifier can look up `className` and
 * `priority` from the `Detail.type` returned by winkNLP.
 */
interface CompiledPatternMetaInterface {
  readonly className: string;
  readonly priority:  number;
}

// ── WinknlpEntitiesClassifier ──────────────────────────────────────────────────

/**
 * Classifier task that emits winkNLP-based custom-entity proposals.
 *
 * @remarks
 * One `winkNLP` model instance is shared for the entire pipeline run.
 * All configured patterns are registered via `learnCustomEntities` once at
 * construction. Per-record, the classifier reads each configured prose field
 * from `state.input`, runs `nlp.readDoc(text)`, and for each matched custom
 * entity emits one {@link ClassificationProposalInterface}:
 *
 * - `source: 'classify:winknlp-entities'`
 * - `className` and `priority` from the pattern config
 * - `confidence: 1` (pattern-match is binary)
 * - `reasons`: `['winknlp:pattern=<name>', 'winknlp:matched=<snippet>',
 *               'winknlp:field=<fieldName>']`
 *
 * @example
 * ```ts
 * const classifier = WinknlpEntitiesClassifier.create({
 *   patterns: [
 *     {
 *       name:      'feat-action-cost',
 *       patterns:  ['[ACTION] cost', 'cost [NUMBER] action'],
 *       className: 'feat',
 *       priority:  28,
 *     },
 *   ],
 *   fields: ['description', 'summary'],
 * });
 * registry.register('classify:winknlp-entities', classifier.execute);
 * ```
 *
 * @category Classification
 * @since 0.6.0
 * @see {@link WinknlpEntitiesConfigInterface}
 * @see {@link ClassificationProposalInterface}
 * @group Classifiers
 */
export class WinknlpEntitiesClassifier {
  /** Shared winkNLP instance with all custom entities pre-registered. */
  readonly #nlp:  WinkMethods;
  /** Frozen lookup: pattern name -> { className, priority }. */
  readonly #meta: Readonly<Record<string, CompiledPatternMetaInterface>>;
  /** Ordered list of prose field names to inspect per record. */
  readonly #fields: ReadonlyArray<string>;

  private constructor(
    nlp:    WinkMethods,
    meta:   Readonly<Record<string, CompiledPatternMetaInterface>>,
    fields: ReadonlyArray<string>,
  ) {
    this.#nlp    = nlp;
    this.#meta   = meta;
    this.#fields = fields;
    // Bind execute so it can be passed as a bare function reference to
    // TaskRegistry.register() without losing its `this` context.
    this.execute = this.#executeImpl.bind(this);
  }

  /**
   * Creates a {@link WinknlpEntitiesClassifier} instance from raw config.
   *
   * @remarks
   * Initialises the winkNLP model and calls `learnCustomEntities` once with
   * all configured patterns. If winkNLP rejects a pattern, the error is
   * wrapped in an {@link OutputConfigError} that names the offending pattern's
   * `name` field.
   *
   * @param config - Raw winkNLP-entities config from the target's
   *   `classification.winknlpEntities` block.
   * @returns A fully constructed, ready-to-register classifier instance.
   * @throws {OutputConfigError} When any pattern is rejected by winkNLP's
   *   `learnCustomEntities`, naming the pattern's `name` field.
   */
  public static create(config: WinknlpEntitiesConfigInterface): WinknlpEntitiesClassifier {
    const nlp = winkNlp(model);

    // Build the CustomEntityExample array for learnCustomEntities.
    const examples: CustomEntityExample[] = config.patterns.map((entry) => ({
      name:     entry.name,
      patterns: entry.patterns as string[],
    }));

    // Build the name -> { className, priority } lookup (used per-record).
    const meta: Record<string, CompiledPatternMetaInterface> = {};
    for (const entry of config.patterns) {
      meta[entry.name] = {
        className: entry.className,
        priority:  entry.priority ?? 28,
      };
    }

    // Register all patterns at once. Pass matchValue:false / usePOS:false /
    // useEntity:false so that pattern strings are matched against normalized
    // token values (lowercase) as plain literals. This is the correct mode
    // for content-based pattern matching on prose fields: `"two actions"` in
    // the pattern matches the literal tokens "two" and "actions" regardless of
    // the model's POS or entity-type assignments.
    //
    // learnCustomEntities throws on malformed patterns; we catch and re-throw
    // as OutputConfigError naming the entry.
    try {
      nlp.learnCustomEntities(examples, { matchValue: false, usePOS: false, useEntity: false });
    } catch (err) {
      const cause = err instanceof Error ? err : undefined;
      // Identify which pattern caused the failure for a useful error message.
      // winkNLP does not expose per-pattern error location, so we surface the
      // full patterns array names in the message.
      const nameList = config.patterns.map((p) => `"${p.name}"`).join(', ');
      throw OutputConfigError.create(
        `classify:winknlp-entities: learnCustomEntities failed for pattern(s) ${nameList}: ${cause?.message ?? String(err)}`,
        { cause, metadata: { patterns: config.patterns.map((p) => p.name) } },
      );
    }

    const fields = config.fields !== undefined && config.fields.length > 0
      ? [...config.fields]
      : ['description'];

    logger.debug('create', 'WinknlpEntitiesClassifier constructed', {
      patternCount: examples.length,
      fields,
    });

    return new WinknlpEntitiesClassifier(nlp, Object.freeze(meta), Object.freeze(fields));
  }

  /**
   * Bound pipeline task function for `classify:winknlp-entities`.
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
    logger.debug('execute', 'WinknlpEntitiesClassifier invoked', {
      targetId:   state.targetId,
      fieldCount: this.#fields.length,
    });

    const newProposals: ClassificationProposalInterface[] = [];

    for (const fieldName of this.#fields) {
      const raw = state.input[fieldName];
      if (typeof raw !== 'string' || raw.length === 0) {
        // Field absent, not a string, or empty -- silently skip per B3 spec.
        continue;
      }

      const doc  = this.#nlp.readDoc(raw);
      const its  = this.#nlp.its;
      const details = doc.customEntities().out(its.detail) as Detail[];

      for (const detail of details) {
        const patternMeta = this.#meta[detail.type];
        if (patternMeta === undefined) {
          // Unknown pattern name returned by winkNLP (should not happen
          // given we registered all patterns ourselves, but guard anyway).
          logger.warn('execute', 'Unknown custom entity type from winkNLP', {
            targetId: state.targetId,
            type:     detail.type,
          });
          continue;
        }

        const snippet = detail.value.length > MAX_SNIPPET_LENGTH
          ? detail.value.slice(0, MAX_SNIPPET_LENGTH)
          : detail.value;

        newProposals.push({
          source:     'classify:winknlp-entities',
          className:  patternMeta.className,
          priority:   patternMeta.priority,
          confidence: 1,
          reasons: [
            `winknlp:pattern=${detail.type}`,
            `winknlp:matched=${snippet}`,
            `winknlp:field=${fieldName}`,
          ],
        });
      }
    }

    if (newProposals.length > 0) {
      (state as unknown as { classifications: ReadonlyArray<ClassificationProposalInterface> })
        .classifications = [...state.classifications, ...newProposals];

      logger.info('execute', 'winkNLP entity proposals emitted', {
        targetId:      state.targetId,
        proposalCount: newProposals.length,
      });
    } else {
      logger.debug('execute', 'No winkNLP custom entities matched', {
        targetId: state.targetId,
      });
    }

    await next();
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// `classify:winknlp-entities` self-registering plugin (silo migration, task #22)
// ──────────────────────────────────────────────────────────────────────────────

/** Plugin name shared by the lifecycle hook and the per-record task. */
export const WINKNLP_ENTITIES_PLUGIN_NAME = 'classify:winknlp-entities' as const;

/** Default priority emitted on proposals when a pattern entry omits `priority`. */
const WINKNLP_DEFAULT_PRIORITY = 28;

/**
 * AJV schema fragment for the `winknlpEntities` config namespace.
 *
 * @remarks
 * Compiled against `ctx.ajv` during the plugin's `onRunStart` hook. Mirrors
 * the legacy `target.schema.json` fragment for `classification.winknlpEntities`,
 * lifted to the new flat namespace used by the silo contract.
 *
 * @category Classification
 * @since 0.7.0
 */
export const winknlpEntitiesConfigSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['patterns'],
  properties: {
    patterns: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'patterns', 'className'],
        properties: {
          name:      { type: 'string', minLength: 1 },
          patterns:  { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
          className: { type: 'string', minLength: 1 },
          priority:  { type: 'integer', minimum: 0 },
        },
      },
    },
    fields: { type: 'array', items: { type: 'string', minLength: 1 } },
  },
} as const;

/**
 * Per-context cache populated at `onRunStart` and consumed on every
 * per-record dispatch. A `WeakMap` key keeps the cache scoped to a single
 * run-wide context; concurrent runs with separate contexts each carry their
 * own compiled state without collision.
 *
 * @internal
 */
interface CompiledWinknlpStateInterface {
  readonly nlp:    WinkMethods;
  readonly meta:   Readonly<Record<string, CompiledPatternMetaInterface>>;
  readonly fields: ReadonlyArray<string>;
}

const compiledByContext = new WeakMap<PipelineContextInterface, CompiledWinknlpStateInterface>();

type MutableContext = { -readonly [K in keyof PipelineContextInterface]: PipelineContextInterface[K] };

/**
 * Validates `ctx.config.winknlpEntities` against the AJV schema fragment, then
 * loads the winkNLP model and registers all configured patterns once. Caches
 * the compiled state in `compiledByContext`.
 *
 * @internal
 */
TaskRegistry.registerHook(WINKNLP_ENTITIES_PLUGIN_NAME, 'onRunStart', (ctx) => {
  const raw = (ctx.config as Readonly<Record<string, unknown>>)['winknlpEntities'];
  if (raw === undefined) {
    logger.debug('onRunStart', 'no winknlpEntities config; classify:winknlp-entities will be silent');
    return;
  }

  // Validate via the run-wide shared AJV instance per the silo contract.
  const validate = ctx.ajv.compile<WinknlpEntitiesConfigInterface>(winknlpEntitiesConfigSchema);
  if (!validate(raw)) {
    const errs = validate.errors !== null && validate.errors !== undefined
      ? validate.errors.map((e) => `${e.instancePath} ${e.message ?? ''}`.trim()).join('; ')
      : 'unknown';
    throw OutputConfigError.create(
      `classify:winknlp-entities: config validation failed: ${errs}`,
      { metadata: { errors: validate.errors ?? [] } },
    );
  }

  const config = raw;

  const nlp = winkNlp(model);

  // Build the CustomEntityExample array for learnCustomEntities.
  const examples: CustomEntityExample[] = config.patterns.map((entry) => ({
    name:     entry.name,
    patterns: entry.patterns as string[],
  }));

  // Build the name -> { className, priority } lookup (used per-record).
  const meta: Record<string, CompiledPatternMetaInterface> = {};
  for (const entry of config.patterns) {
    meta[entry.name] = {
      className: entry.className,
      priority:  entry.priority ?? WINKNLP_DEFAULT_PRIORITY,
    };
  }

  // learnCustomEntities throws on malformed patterns; we catch and re-throw
  // as OutputConfigError naming the offending entry(ies).
  try {
    nlp.learnCustomEntities(examples, { matchValue: false, usePOS: false, useEntity: false });
  } catch (err) {
    const cause = err instanceof Error ? err : undefined;
    const nameList = config.patterns.map((p) => `"${p.name}"`).join(', ');
    throw OutputConfigError.create(
      `classify:winknlp-entities: learnCustomEntities failed for pattern(s) ${nameList}: ${cause?.message ?? String(err)}`,
      { cause, metadata: { patterns: config.patterns.map((p) => p.name) } },
    );
  }

  const fields = config.fields !== undefined && config.fields.length > 0
    ? Object.freeze([...config.fields])
    : Object.freeze(['description']);

  compiledByContext.set(ctx as MutableContext, {
    nlp,
    meta:   Object.freeze(meta),
    fields,
  });

  logger.debug('onRunStart', 'classify:winknlp-entities compiled', {
    patternCount: examples.length,
    fields,
  });
});

/**
 * Per-record task body for `classify:winknlp-entities` (plugin form).
 *
 * @internal
 */
const classifyWinknlpEntitiesTask: TaskFnInterface<PipelineStateInterface> = async (
  next:  NextFnInterface,
  state: PipelineStateInterface,
): Promise<void> => {
  const ctx = state.context;
  const compiled = ctx !== undefined ? compiledByContext.get(ctx) : undefined;
  if (compiled === undefined) {
    // Plugin not configured for this run; clean no-op.
    await next();
    return;
  }

  logger.debug('execute', 'classify:winknlp-entities invoked', {
    targetId:   state.targetId,
    fieldCount: compiled.fields.length,
  });

  const newProposals: ClassificationProposalInterface[] = [];

  for (const fieldName of compiled.fields) {
    const raw = state.input[fieldName];
    if (typeof raw !== 'string' || raw.length === 0) {
      continue;
    }

    const doc     = compiled.nlp.readDoc(raw);
    const its     = compiled.nlp.its;
    const details = doc.customEntities().out(its.detail) as Detail[];

    for (const detail of details) {
      const patternMeta = compiled.meta[detail.type];
      if (patternMeta === undefined) {
        logger.warn('execute', 'Unknown custom entity type from winkNLP', {
          targetId: state.targetId,
          type:     detail.type,
        });
        continue;
      }

      const snippet = detail.value.length > MAX_SNIPPET_LENGTH
        ? detail.value.slice(0, MAX_SNIPPET_LENGTH)
        : detail.value;

      newProposals.push({
        source:     WINKNLP_ENTITIES_PLUGIN_NAME,
        className:  patternMeta.className,
        priority:   patternMeta.priority,
        confidence: 1,
        reasons: [
          `winknlp:pattern=${detail.type}`,
          `winknlp:matched=${snippet}`,
          `winknlp:field=${fieldName}`,
        ],
      });
    }
  }

  if (newProposals.length > 0) {
    (state as unknown as { classifications: ReadonlyArray<ClassificationProposalInterface> })
      .classifications = [...state.classifications, ...newProposals];

    logger.info('execute', 'winkNLP entity proposals emitted', {
      targetId:      state.targetId,
      proposalCount: newProposals.length,
    });
  } else {
    logger.debug('execute', 'No winkNLP custom entities matched', {
      targetId: state.targetId,
    });
  }

  await next();
};

TaskRegistry.register(WINKNLP_ENTITIES_PLUGIN_NAME, classifyWinknlpEntitiesTask, {
  proposesClass: true,
});
