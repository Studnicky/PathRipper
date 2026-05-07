/**
 * @fileoverview `classify:winknlp-entities` self-registering plugin module —
 * silo-driven equivalent of the legacy `WinknlpEntitiesClassifier`.
 *
 * @remarks
 * Side-effect-registers two things on the global `TaskRegistry` at import time:
 *
 * 1. An `onRunStart` lifecycle hook that
 *    - validates `ctx.config.winknlpEntities` against the AJV schema fragment
 *      exported below,
 *    - loads `wink-eng-lite-web-model` once,
 *    - calls `learnCustomEntities` once with all configured patterns (throwing
 *      {@link OutputConfigError} naming the offending pattern when winkNLP
 *      rejects), and
 *    - caches the model + per-pattern metadata + prose-field list in a
 *      module-private `WeakMap` keyed by the run-wide context.
 *
 * 2. A per-record task that reads the cached compiled state via
 *    `state.context`, tokenizes each configured prose field with the cached
 *    `winkNLP` instance, and pushes one
 *    {@link ClassificationProposalInterface} per matched custom entity.
 *
 * The hook no-ops when `ctx.config.winknlpEntities` is absent — the silo
 * contract requires optional-config plugins to handle absence at startup, not
 * at per-record time. The per-record task likewise no-ops when the cache slot
 * is unpopulated, preserving fail-fast semantics: by the time a record flows,
 * either the plugin is fully configured or it is silent.
 *
 * Configuration namespace: `ctx.config.winknlpEntities` (a flat per-plugin
 * namespace per the v0.7.0 silo contract — not nested under `classification.*`).
 *
 * @module classify/winknlpEntities
 * @category Classification
 * @since 0.7.0
 */

import type { WinkMethods, CustomEntityExample, Detail } from 'wink-nlp';
import winkNlpModule from 'wink-nlp';
import modelModule   from 'wink-eng-lite-web-model';

import { TaskRegistry }                                  from '../registry/TaskRegistry.js';
import { Logger }                                        from '../modules/logger/logger.js';
import { OutputConfigError }                             from '../errors/OutputConfigError.js';
import type { NextFnInterface, TaskFnInterface }         from '../types/Pipeline.js';
import type {
  PipelineContextInterface,
  PipelineStateInterface,
  ClassificationProposalInterface,
}                                                        from '../types/PipelineState.js';

// CJS default interop (same idiom as `src/context/ajv.ts` and the legacy
// `WinknlpEntitiesClassifier`).
const winkNlp = (winkNlpModule as unknown as { default?: typeof winkNlpModule }).default
  ?? winkNlpModule;
const model   = (modelModule   as unknown as { default?: typeof modelModule   }).default
  ?? modelModule;

const log = Logger.forComponent('classify:winknlp-entities');

/** Maximum length (chars) of the matched-text snippet carried in a reason string. */
const MAX_SNIPPET_LENGTH = 80;

/** Default priority emitted on proposals when a pattern entry omits `priority`. */
const DEFAULT_PRIORITY = 28;

// ── Config interfaces ──────────────────────────────────────────────────────────

/**
 * A single winkNLP custom-entity pattern entry as it appears in the target
 * config's `winknlpEntities.patterns[]` array.
 *
 * @category Classification
 * @since 0.7.0
 * @group Types
 */
export interface WinknlpPatternEntryInterface {
  /**
   * Unique pattern name — passed as `name` to `learnCustomEntities` and
   * returned as `type` on each matched entity. Used to look up the
   * corresponding `className` and `priority` when a match fires.
   */
  readonly name:      string;
  /**
   * winkNLP pattern strings. Each string uses token literals (lower-case
   * words) and/or POS-tag / entity-type class brackets (e.g. `NOUN`,
   * `[ADJ]`, `CARDINAL`). Alternatives are expressed as `[option1|option2]`.
   */
  readonly patterns:  ReadonlyArray<string>;
  /** Ontology class id proposed when this pattern fires. */
  readonly className: string;
  /** Numeric priority forwarded onto the emitted proposal. Default 28. */
  readonly priority?: number | undefined;
}

/**
 * Configuration block for the `classify:winknlp-entities` plugin, located on
 * the run-wide silo at `ctx.config.winknlpEntities`.
 *
 * @category Classification
 * @since 0.7.0
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

// ── AJV schema fragment ───────────────────────────────────────────────────────

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

// ── Compiled cache ────────────────────────────────────────────────────────────

/**
 * Pre-compiled per-pattern metadata used on the hot per-record path.
 * Keyed by the pattern `name` so the per-record task can look up `className`
 * and `priority` from the `Detail.type` returned by winkNLP.
 *
 * @internal
 */
interface CompiledPatternMetaInterface {
  readonly className: string;
  readonly priority:  number;
}

/**
 * Per-context cache populated at `onRunStart` and consumed on every
 * per-record dispatch. A `WeakMap` key keeps the cache scoped to a single
 * run-wide context; concurrent runs with separate contexts each carry their
 * own compiled state without collision.
 *
 * @internal
 */
interface CompiledStateInterface {
  readonly nlp:    WinkMethods;
  readonly meta:   Readonly<Record<string, CompiledPatternMetaInterface>>;
  readonly fields: ReadonlyArray<string>;
}

const compiledByContext = new WeakMap<PipelineContextInterface, CompiledStateInterface>();

// ── onRunStart hook ───────────────────────────────────────────────────────────

type MutableContext = { -readonly [K in keyof PipelineContextInterface]: PipelineContextInterface[K] };

/**
 * Validates `ctx.config.winknlpEntities` against the AJV schema fragment, then
 * loads the winkNLP model and registers all configured patterns once. Caches
 * the compiled state in `compiledByContext`.
 *
 * No-ops cleanly when `ctx.config.winknlpEntities` is absent. Throws
 * {@link OutputConfigError} on schema-validation failure or when winkNLP
 * rejects any pattern.
 */
TaskRegistry.registerHook('classify:winknlp-entities', 'onRunStart', (ctx) => {
  const raw = (ctx.config as Readonly<Record<string, unknown>>)['winknlpEntities'];
  if (raw === undefined) {
    log.debug('onRunStart', 'no winknlpEntities config; classify:winknlp-entities will be silent');
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
      priority:  entry.priority ?? DEFAULT_PRIORITY,
    };
  }

  // Register all patterns at once. matchValue:false / usePOS:false /
  // useEntity:false matches pattern strings against normalized (lowercase)
  // token values as plain literals — the correct mode for content-based
  // pattern matching on prose fields.
  //
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

  log.debug('onRunStart', 'classify:winknlp-entities compiled', {
    patternCount: examples.length,
    fields,
  });
});

// ── Per-record task ───────────────────────────────────────────────────────────

/**
 * Per-record task body for `classify:winknlp-entities`. Reads the
 * configured prose fields off `state.input`, tokenizes each via the cached
 * shared `winkNLP` instance, and pushes one
 * {@link ClassificationProposalInterface} per matched custom entity onto
 * `state.classifications`.
 */
const classifyWinknlpEntities: TaskFnInterface<PipelineStateInterface> = async (
  next:  NextFnInterface,
  state: PipelineStateInterface,
): Promise<void> => {
  const ctx = state.context;
  const compiled = ctx !== undefined ? compiledByContext.get(ctx) : undefined;
  if (compiled === undefined) {
    // Plugin not configured for this run; clean no-op (matches the silo
    // contract for optional-config plugins).
    await next();
    return;
  }

  log.debug('execute', 'classify:winknlp-entities invoked', {
    targetId:   state.targetId,
    fieldCount: compiled.fields.length,
  });

  const newProposals: ClassificationProposalInterface[] = [];

  for (const fieldName of compiled.fields) {
    const raw = state.input[fieldName];
    if (typeof raw !== 'string' || raw.length === 0) {
      // Field absent, not a string, or empty — silently skip.
      continue;
    }

    const doc     = compiled.nlp.readDoc(raw);
    const its     = compiled.nlp.its;
    const details = doc.customEntities().out(its.detail) as Detail[];

    for (const detail of details) {
      const patternMeta = compiled.meta[detail.type];
      if (patternMeta === undefined) {
        // Unknown pattern name returned by winkNLP (should not happen given
        // we registered all patterns ourselves, but guard anyway).
        log.warn('execute', 'Unknown custom entity type from winkNLP', {
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

    log.info('execute', 'winkNLP entity proposals emitted', {
      targetId:      state.targetId,
      proposalCount: newProposals.length,
    });
  } else {
    log.debug('execute', 'No winkNLP custom entities matched', {
      targetId: state.targetId,
    });
  }

  await next();
};

TaskRegistry.register('classify:winknlp-entities', classifyWinknlpEntities, {
  proposesClass: true,
});
