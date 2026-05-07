/**
 * @fileoverview `classify:source` self-registering plugin module.
 *
 * @remarks
 * Silo-contract conversion of {@link SourceClassifier}. This module has two
 * top-level side effects, both fired at import time:
 *
 * 1. {@link TaskRegistry.registerHook}`('context:source-classifier',
 *    'onRunStart', ...)` — validates `ctx.config.source` against
 *    {@link sourceConfigSchema} via `ctx.ajv.compile(...)`. The hook no-ops
 *    when the namespace is absent so the plugin coexists with the legacy
 *    {@link ClassificationFactory} wiring (which reads
 *    `targetConfig.classification.source`); it fails fast when the namespace
 *    is present but the value is anything other than literal `true`.
 *
 * 2. {@link TaskRegistry.register}`('classify:source', sourceClassifyTask,
 *    { proposesClass: false })` — registers the per-record task. The body
 *    inspects `state.input._source`, appends a single
 *    `__source__` proposal with `source: 'classify:source'` when the block
 *    is present, and unconditionally calls `await next()`. `proposesClass`
 *    is `false` because `__source__` is a metadata gate, not a class vote
 *    (`SourceClassifier` is intentionally absent from `CLASS_PROPOSERS` in
 *    `src/config/SquashageConfig.ts`).
 *
 * The plugin reads RDF emit infrastructure from neither `ctx.factory` nor
 * `ctx.dataset` because it emits no quads — it only mutates
 * `state.classifications`.
 *
 * Idempotent: repeated imports overwrite the same registry slots; the
 * registry warns on overwrite. Tests may import this module before each run
 * without leaking state between runs.
 *
 * @module classification/plugins/source
 * @category Classification
 * @since 0.7.0
 * @see {@link SourceClassifier} — the legacy class-based implementation
 *   that the orchestrator continues to wire via `ClassificationFactory`
 *   until task #24 rewires.
 */

import { TaskRegistry }                        from '../registry/TaskRegistry.js';
import { Logger }                              from '../modules/logger/logger.js';
import { ExternalSchemaError }                 from '../errors/ExternalSchemaError.js';
import type { NextFnInterface, TaskFnInterface } from '../types/Pipeline.js';
import type {
  ClassificationProposalInterface,
  PipelineContextInterface,
  PipelineStateInterface,
} from '../types/PipelineState.js';

const log = Logger.forComponent('classify:source');

// ── Plugin registration names ─────────────────────────────────────────────────

/** Per-record task name registered in the {@link TaskRegistry}. */
export const SOURCE_TASK_NAME = 'classify:source' as const;

/** Lifecycle hook name for the onRunStart config-validation step. */
export const SOURCE_HOOK_NAME = 'context:source-classifier' as const;

// ── AJV config schema ────────────────────────────────────────────────────────

/**
 * AJV schema fragment for `ctx.config.source` (the plugin's config namespace).
 *
 * @remarks
 * The legal value is the literal `true`. Any other value — `false`, a string,
 * an object, `null` — fails the compiled validator and the `onRunStart` hook
 * raises {@link ExternalSchemaError}. The namespace itself is optional; an
 * absent `source` key skips validation and skips registration of the per-record
 * task's effects (the task is always registered, but emits no proposal when
 * `_source` is absent on the record, mirroring the legacy class).
 *
 * Exported so unit tests can compile the schema directly with the run-wide
 * `ctx.ajv` and assert acceptance/rejection behaviour without round-tripping
 * through the orchestrator.
 *
 * @category Classification
 * @since 0.7.0
 */
export const sourceConfigSchema = {
  $id:   'https://squashage.dev/schemas/classify-source-config.json',
  type:  'boolean',
  const: true,
} as const;

// ── onRunStart hook: validate ctx.config.source ──────────────────────────────

TaskRegistry.registerHook(
  SOURCE_HOOK_NAME,
  'onRunStart',
  (ctx: PipelineContextInterface): void => {
    const raw = ctx.config['source'];

    // Absent namespace: no-op so the plugin coexists with the legacy factory
    // wiring (which reads `targetConfig.classification.source`). When the
    // orchestrator rewires in task #24, the flat namespace becomes the
    // primary source of truth and this branch will simply mean
    // "classify:source is not requested for this target".
    if (raw === undefined) {
      log.debug('onRunStart', 'ctx.config.source absent; classify:source not requested');
      return;
    }

    const validate = ctx.ajv.compile(sourceConfigSchema);
    if (!validate(raw)) {
      throw ExternalSchemaError.create(
        'classify:source: ctx.config.source must be the literal true',
        {
          metadata: {
            hook:   SOURCE_HOOK_NAME,
            target: ctx.target,
            errors: validate.errors,
            received: typeof raw,
          },
        },
      );
    }

    log.debug('onRunStart', 'ctx.config.source validated', { target: ctx.target });
  },
);

// ── Per-record task: classify:source ─────────────────────────────────────────

/**
 * Per-record pipeline task body for `classify:source`.
 *
 * @remarks
 * Inspects `state.input._source` and, when the block is a plain object,
 * appends one {@link ClassificationProposalInterface} carrying `className:
 * '__source__'` to `state.classifications`. The proposal is a metadata gate —
 * the ConflictResolver preserves it in evidence but never elects it as the
 * winning class (see `__source__` handling in
 * `src/classification/tasks/ConflictResolver.ts`). When `_source` is absent
 * or not a plain object, no proposal is emitted.
 *
 * This task is `proposesClass: false` (registered below) because
 * `__source__` is a metadata sentinel rather than a class vote;
 * `SourceClassifier` is intentionally absent from `CLASS_PROPOSERS` in
 * `src/config/SquashageConfig.ts`.
 *
 * @param next  - Advance function; called unconditionally after the proposal
 *   (or no-op) step.
 * @param state - Mutable per-record pipeline state.
 */
const sourceClassifyTask: TaskFnInterface<PipelineStateInterface> = async (
  next:  NextFnInterface,
  state: PipelineStateInterface,
): Promise<void> => {
  log.debug('execute', 'classify:source invoked', { targetId: state.targetId });

  const raw = state.input['_source'];

  if (raw === undefined || raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    log.debug('execute', '_source block absent; emitting no proposal', { targetId: state.targetId });
    await next();
    return;
  }

  const src = raw as Record<string, unknown>;

  const reasons: string[] = [];
  if (typeof src['target']   === 'string') reasons.push(`source.target=${src['target']}`);
  if (typeof src['plugin']   === 'string') reasons.push(`source.plugin=${src['plugin']}`);
  if (typeof src['schemaId'] === 'string') reasons.push(`source.schemaId=${src['schemaId']}`);

  const proposal: ClassificationProposalInterface = {
    source:     'classify:source',
    className:  '__source__',
    priority:   0,
    confidence: 1,
    reasons,
  };

  // Append-only mutation of the readonly array slot, mirroring the convention
  // used by every other class-proposer in the legacy classifier set.
  (state as unknown as { classifications: ReadonlyArray<ClassificationProposalInterface> })
    .classifications = [...state.classifications, proposal];

  log.info('execute', 'Source proposal emitted', { targetId: state.targetId, reasons });

  await next();
};

TaskRegistry.register(SOURCE_TASK_NAME, sourceClassifyTask, { proposesClass: false });
