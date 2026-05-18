/**
 * @fileoverview `classify:ontology` pipeline task — self-registering plugin.
 *
 * @remarks
 * Class IRI validation gate. Inspects each proposal on `state.classifications`
 * emitted by upstream `classify:*` tasks and, for any proposal whose
 * `className` is not present in the configured ontology class map, emits a new
 * `__validation__` proposal that flags the unknown class. The
 * `classify:conflict` resolver downstream reads these sentinel proposals as
 * evidence when building the final
 * {@link ClassificationEvidenceInterface}.
 *
 * This task does NOT vote for a class — its sole job is to annotate the
 * proposal trail with ontology-awareness so that downstream review tooling and
 * the conflict resolver can surface unknown-class problems. The plugin
 * therefore does NOT declare `proposesClass: true` in its registration
 * manifest.
 *
 * The pipeline task name remains `classify:ontology` (unchanged from the
 * factory-era wiring). The config namespace is `ontologyClassifier`, NOT
 * `ontology` — the latter is already taken by the json-tology engine config
 * (`target.ontology.engine === 'json-tology'`). Documenting this asymmetry
 * prevents future re-collision attempts.
 *
 * Self-registration:
 *   - `onRunStart` hook validates `ctx.config.ontologyClassifier` against the
 *     exported AJV schema fragment ({@link ontologyClassifierConfigSchema}),
 *     freezes the `classes` map, and caches it on a module-private slot.
 *     Fail-fast: an invalid or absent config block throws
 *     {@link OutputConfigError} during `onRunStart` so the run never reaches
 *     per-record dispatch with a missing ontology gate.
 *   - per-record task reads the cached frozen map and emits validation
 *     proposals for unknown classNames.
 *
 * Legacy class export {@link OntologyClassifier} is retained during the
 * v0.7.0 silo migration so {@link ClassificationFactory} keeps compiling
 * without modification (per task #16 hard constraint). Once the factory is
 * deleted in a later silo task, the class export goes with it.
 *
 * @module
 * @since 0.1.0
 * @category Classification
 */

import type { JSONSchemaType } from 'ajv';

import type { NextFnInterface, TaskFnInterface } from '../../types/Pipeline.js';
import type { PipelineContextInterface, PipelineStateInterface, ClassificationProposalInterface } from '../../types/PipelineState.js';
import { OutputConfigError } from '../../errors/OutputConfigError.js';
import { Logger } from '../../modules/logger/logger.js';
import { TaskRegistry } from '../../registry/TaskRegistry.js';

const logger = Logger.forComponent('OntologyClassifier');

// ── Constants ─────────────────────────────────────────────────────────────────

/** Pipeline task name; UNCHANGED from the factory-era wiring. */
export const TASK_NAME = 'classify:ontology' as const;

/**
 * Top-level config namespace this plugin reads from `ctx.config`.
 *
 * @remarks
 * RENAMED from `ontology` to `ontologyClassifier` to disambiguate from the
 * json-tology engine config block (`ctx.config.ontology.engine`). The
 * pipeline task name (`classify:ontology`) is unchanged.
 */
export const CONFIG_NAMESPACE = 'ontologyClassifier' as const;

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Configuration for the ontology class IRI validator.
 *
 * @category Classification
 * @since 0.1.0
 * @see {@link ontologyClassifierConfigSchema}
 * @group Types
 */
export interface OntologyConfigInterface {
  /**
   * Map from className (matches proposal.className) to its canonical class IRI
   * in the target's ontology. Proposals whose className is missing from this
   * map are flagged as "ontology-unknown" — the conflict resolver downstream
   * decides how to handle them.
   */
  readonly classes: Readonly<Record<string, string>>;
}

// ── AJV schema (config namespace `ontologyClassifier`) ────────────────────────

/**
 * AJV schema fragment for the `ontologyClassifier` config namespace.
 *
 * @remarks
 * Validates the shape `{ classes: Record<string, string-format:uri> }`. Used
 * by the `onRunStart` hook to fail-fast when a target declares
 * `classify:ontology` in its pipeline but supplies an empty / malformed
 * `ontologyClassifier` config block.
 *
 * @category Classification
 * @since 0.7.0
 * @group Schema
 */
export const ontologyClassifierConfigSchema: JSONSchemaType<OntologyConfigInterface> = {
  type: 'object',
  required: ['classes'],
  additionalProperties: false,
  properties: {
    classes: {
      type: 'object',
      minProperties: 1,
      required: [],
      additionalProperties: {
        type: 'string',
        format: 'uri',
        minLength: 1,
      },
    },
  },
};

// ── Metadata sentinels ────────────────────────────────────────────────────────

/**
 * Set of className sentinels that should never be validated against the
 * ontology map. These are internal coordination tokens, not class proposals.
 *
 * @internal
 */
const METADATA_SENTINELS = new Set<string>(['__source__', '__validation__', 'unknown']);

// ── Module-private cached state (populated by onRunStart) ─────────────────────

/**
 * Frozen ontology class map cached at `onRunStart`. Per-record dispatch reads
 * this directly. `null` until `onRunStart` populates it.
 *
 * @internal
 */
let frozenClasses: Readonly<Record<string, string>> | null = null;

// ── Self-registered task ──────────────────────────────────────────────────────

/**
 * Per-record `classify:ontology` task — reads the closure-cached frozen class
 * map populated by the `onRunStart` hook and emits `__validation__` proposals
 * for unknown classNames.
 *
 * @internal
 */
const ontologyClassifierTask: TaskFnInterface<PipelineStateInterface> = async (
  next:  NextFnInterface,
  state: PipelineStateInterface,
): Promise<void> => {
  if (frozenClasses === null) {
    throw OutputConfigError.create(
      `${TASK_NAME}: per-record dispatch reached before onRunStart populated the class map. ` +
      `Ensure ${CONFIG_NAMESPACE}.classes is configured for the target.`,
      { metadata: { task: TASK_NAME } },
    );
  }

  logger.debug('execute', 'OntologyClassifier invoked', {
    targetId:        state.targetId,
    proposalCount:   state.classifications.length,
    knownClassCount: Object.keys(frozenClasses).length,
  });

  OntologyClassifier.emitValidationProposals(state, frozenClasses);

  await next();
};

// ── onRunStart hook (config validation + class map freeze) ────────────────────

/**
 * Validates `ctx.config.ontologyClassifier` against the exported AJV schema
 * fragment, freezes the `classes` map, and caches it on the module-private
 * {@link frozenClasses} slot. Fail-fast: throws {@link OutputConfigError} if
 * the namespace is absent or invalid.
 *
 * @internal
 */
function onRunStartHook(ctx: PipelineContextInterface): void {
  const raw = (ctx.config as Readonly<Record<string, unknown>>)[CONFIG_NAMESPACE];
  if (raw === undefined) {
    throw OutputConfigError.create(
      `${TASK_NAME}: missing config namespace "${CONFIG_NAMESPACE}". ` +
      `Add a top-level "${CONFIG_NAMESPACE}": { "classes": { ... } } block to the target config, ` +
      `or remove ${TASK_NAME} from the pipeline.`,
      { metadata: { task: TASK_NAME, namespace: CONFIG_NAMESPACE } },
    );
  }

  const validate = ctx.ajv.compile(ontologyClassifierConfigSchema);
  if (!validate(raw)) {
    const errors = validate.errors ?? [];
    const detail = errors.map(e => `${e.instancePath}: ${e.message ?? '(no message)'}`).join('; ');
    throw OutputConfigError.create(
      `${TASK_NAME}: invalid "${CONFIG_NAMESPACE}" config — ${detail || 'schema validation failed'}.`,
      { metadata: { task: TASK_NAME, namespace: CONFIG_NAMESPACE, errors } },
    );
  }

  frozenClasses = Object.freeze({ ...raw.classes });

  logger.debug('onRunStart', 'ontologyClassifier config validated and class map frozen', {
    target:     ctx.target,
    classCount: Object.keys(frozenClasses).length,
  });
}

// ── Self-registration (side-effect at module load) ────────────────────────────

TaskRegistry.register(TASK_NAME, ontologyClassifierTask);
TaskRegistry.registerHook(TASK_NAME, 'onRunStart', onRunStartHook);

// ── Legacy class export (factory back-compat during silo migration) ───────────

/**
 * Legacy classifier class retained so {@link ClassificationFactory} keeps
 * compiling unchanged during the v0.7.0 silo migration window.
 *
 * @remarks
 * Iterates `state.classifications` and, for each proposal whose `className` is
 * absent from the configured `classes` map AND is not a metadata sentinel
 * (`__source__`, `__validation__`, `unknown`), emits a new
 * {@link ClassificationProposalInterface} with `className: '__validation__'`.
 * Metadata sentinels are intentionally skipped — they are coordination tokens
 * that carry no class vote and should not themselves trigger further validation.
 *
 * Once {@link ClassificationFactory} is deleted in a later silo migration
 * task, this class export goes with it.
 *
 * @example
 * ```ts
 * const classifier = new OntologyClassifier({
 *   classes: {
 *     feat:  'https://squashage.dev/vocabulary/aonprd#Feat',
 *     spell: 'https://squashage.dev/vocabulary/aonprd#Spell',
 *   },
 * });
 * registry.register('classify:ontology', classifier.execute);
 * ```
 *
 * @category Classification
 * @since 0.1.0
 * @see {@link OntologyConfigInterface}
 * @see {@link ClassificationProposalInterface}
 * @group Classifiers
 */
export class OntologyClassifier {
  /** Frozen ontology class map; keyed by className, value is the canonical IRI. */
  readonly #classes: Readonly<Record<string, string>>;

  /**
   * Creates an {@link OntologyClassifier} instance.
   *
   * @param config - Ontology class map. Empty map throws OutputConfigError.
   * @throws {OutputConfigError} When `config.classes` is empty — a target that
   *   configures `classify:ontology` must supply at least one known class.
   */
  public constructor(config: OntologyConfigInterface) {
    const classCount = Object.keys(config.classes).length;

    if (classCount === 0) {
      throw OutputConfigError.create(
        'OntologyClassifier requires at least one entry in config.classes; ' +
        'received an empty classes map. Remove classify:ontology from the ' +
        'pipeline or supply the ontology class map.',
        { metadata: { task: TASK_NAME, classCount: 0 } },
      );
    }

    this.#classes = Object.freeze({ ...config.classes });

    // Bind execute so it can be passed as a bare function reference to
    // TaskRegistry.register() without losing its `this` context.
    this.execute = this.#executeImpl.bind(this);
  }

  /**
   * Bound pipeline task function for `classify:ontology`.
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
    logger.debug('execute', 'OntologyClassifier invoked', {
      targetId:        state.targetId,
      proposalCount:   state.classifications.length,
      knownClassCount: Object.keys(this.#classes).length,
    });

    OntologyClassifier.emitValidationProposals(state, this.#classes);

    await next();
  }

  // ── Static helpers ────────────────────────────────────────────────────────

  /**
   * Walks `state.classifications`, skipping metadata sentinels, and appends
   * one `__validation__` proposal for every proposal whose `className` is
   * absent from `classes`.
   *
   * @remarks
   * Owned by {@link OntologyClassifier} so the self-registered task and the
   * legacy class share one implementation without a free helper.
   *
   * @internal
   */
  public static emitValidationProposals(
    state:   PipelineStateInterface,
    classes: Readonly<Record<string, string>>,
  ): void {
    const validationProposals: ClassificationProposalInterface[] = [];

    for (const proposal of state.classifications) {
      if (METADATA_SENTINELS.has(proposal.className)) {
        continue;
      }

      if (!(proposal.className in classes)) {
        const reason = `ontology-unknown: ${proposal.className} (from ${proposal.source})`;

        validationProposals.push({
          source:     'classify:ontology',
          className:  '__validation__',
          priority:   0,
          confidence: 1,
          reasons:    [reason],
        });

        logger.debug('emitValidationProposals', 'Unknown className flagged', {
          targetId:  state.targetId,
          className: proposal.className,
          source:    proposal.source,
        });
      }
    }

    if (validationProposals.length > 0) {
      (state as unknown as { classifications: ReadonlyArray<ClassificationProposalInterface> })
        .classifications = [...state.classifications, ...validationProposals];

      logger.info('emitValidationProposals', 'Ontology validation proposals emitted', {
        targetId:        state.targetId,
        validationCount: validationProposals.length,
      });
    } else {
      logger.debug('emitValidationProposals', 'All proposals passed ontology validation', {
        targetId: state.targetId,
      });
    }
  }

  /**
   * Resets the module-private cached class map.
   *
   * @remarks
   * Test-only — production code MUST NOT call this. Tests that exercise
   * `onRunStart` or per-record dispatch across multiple stub configs use this
   * between cases to reset state.
   *
   * @internal
   */
  public static resetForTests(): void {
    frozenClasses = null;
  }
}
