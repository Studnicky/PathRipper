/**
 * @fileoverview `classify:shacl-shape` self-registering plugin.
 *
 * @remarks
 * Side-effect-registers two surfaces on the global {@link TaskRegistry} at
 * import time:
 *
 * 1. **Lifecycle hook** `classify:shacl-shape` (`onRunStart`) — validates the
 *    `shaclShape` namespace on `ctx.config` against this plugin's AJV schema
 *    fragment, parses the shapes graph (file mode) or records that ontology
 *    mode requires `ctx.jt`, and primes a per-context cache for the per-record
 *    surface. When `shapesFrom === 'ontology'` and `ctx.jt` is absent, the
 *    hook logs a warning and marks the run as `disabled`. It MUST NOT throw
 *    in that case — see Optional-key contract below.
 *
 * 2. **Per-record task** `classify:shacl-shape` — extracts every NodeShape
 *    descriptor from the cached graph, validates the record against each, and
 *    appends one {@link ClassificationProposalInterface} per conforming shape.
 *    When the cache reports `disabled === true`, this task no-ops silently
 *    (one `next()` call, no proposals).
 *
 * ## Optional-key (`ctx.jt`) no-op contract
 *
 * Per `docs/context-silo.md`, consumers of optional silo keys MUST no-op or
 * fail-fast at `onRunStart` — never at per-record time. This plugin honours
 * that contract:
 * - Startup: `ctx.jt === undefined && shapesFrom === 'ontology'` -> set
 *   `disabled: true`, log warning, no exception.
 * - Per-record: `disabled === true` -> immediate `next()`, no exception.
 *
 * The disabled state is computed once during `onRunStart` and cached on the
 * per-context entry; per-record dispatch never re-checks `ctx.jt`.
 *
 * ## Pipeline name
 *
 * Both surfaces register under `classify:shacl-shape`. The TaskRegistry keeps
 * its hook map and per-record task map separate so the same name is unambiguous.
 *
 * ## proposesClass
 *
 * The per-record manifest declares `proposesClass: true` so the orchestrator's
 * "≥2 proposers requires `classify:conflict`" enforcement counts this plugin.
 *
 * @module tasks/classifyShaclShape
 * @category Classification
 * @since 0.7.0
 */

import { readFileSync }    from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import type { Quad, NamedNode } from '@rdfjs/types';

import { TaskRegistry }      from '../registry/TaskRegistry.js';
import { Logger }            from '../modules/logger/logger.js';
import { Parser }            from '../rdf/Parser.js';
import { Dataset }           from '../rdf/Dataset.js';
import { dataFactory }       from '../rdf/DataFactory.js';
import { ShaclGate }         from '../shacl/ShaclGate.js';
import { OutputConfigError } from '../errors/OutputConfigError.js';
import { SquashageConfigError } from '../errors/SquashageConfigError.js';

import type { TaskFnInterface, NextFnInterface } from '../types/Pipeline.js';
import type {
  PipelineContextInterface,
  PipelineStateInterface,
  ClassificationProposalInterface,
} from '../types/PipelineState.js';
import type { JsonTologyOntology } from '../ontology/JsonTologyOntology.js';

import type { ShaclShapeClassifierConfigInterface } from '../classification/tasks/ShaclShapeClassifier.js';

const log = Logger.forComponent('classify:shacl-shape');

/** Pipeline name shared by the lifecycle hook and the per-record task. */
export const PLUGIN_NAME = 'classify:shacl-shape' as const;

/** Default proposal priority when `config.priority` is omitted. */
const DEFAULT_PRIORITY = 45;

// ── SHACL / RDF vocabulary constants ─────────────────────────────────────────

const SH       = 'http://www.w3.org/ns/shacl#';
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const XSD      = 'http://www.w3.org/2001/XMLSchema#';

const SH_NODE_SHAPE   = `${SH}NodeShape`;
const SH_PROPERTY     = `${SH}property`;
const SH_PATH         = `${SH}path`;
const SH_TARGET_CLASS = `${SH}targetClass`;
const SH_TARGET_NODE  = `${SH}targetNode`;

// ── AJV schema fragment for the `shaclShape` config namespace ───────────────

/**
 * AJV schema fragment for the `shaclShape` config namespace.
 *
 * @remarks
 * Mirrors the inline fragment in {@link SquashageConfig}'s root schema (see
 * `src/config/SquashageConfig.ts`). Exported so tests and downstream consumers
 * can reference the canonical shape without duplicating it.
 *
 * @category Classification
 * @since 0.7.0
 */
export const SHACL_SHAPE_CONFIG_SCHEMA = {
  type:                 'object',
  additionalProperties: false,
  required:             ['shapesFrom'],
  properties: {
    // `'ontology'` selects the ontology-mode source; any other non-empty string
    // is treated as a filesystem path. `anyOf` (not `oneOf`) because the literal
    // `'ontology'` also satisfies `minLength: 1` — `oneOf` would reject it as
    // ambiguous, which is not the intent.
    shapesFrom: {
      anyOf: [
        { type: 'string', const: 'ontology' },
        { type: 'string', minLength: 1 },
      ],
    },
    priority: { type: 'integer', minimum: 0 },
  },
} as const;

// ── Internal cache types ─────────────────────────────────────────────────────

/**
 * Internal descriptor for one NodeShape extracted from a shapes graph.
 *
 * @internal
 */
interface NodeShapeDescriptorInterface {
  readonly shapeIri:        string;
  readonly targetClassIri:  string | undefined;
  readonly allShapeQuads:   ReadonlyArray<Quad>;
  readonly propertyPathIris: ReadonlyArray<string>;
}

/**
 * Cache entry computed during `onRunStart` and consumed at per-record time.
 *
 * @internal
 */
interface ShapeCacheInterface {
  /** When `true`, the per-record task no-ops without inspecting `ctx.jt`. */
  readonly disabled:    boolean;
  /** Resolved priority for this run. */
  readonly priority:    number;
  /** `'ontology'` or a filesystem path. */
  readonly shapesFrom:  string;
  /**
   * Parsed shape quads when `shapesFrom` is a file path. `null` in ontology
   * mode — the per-record task pulls from `ctx.jt.shacl()` lazily.
   */
  readonly fileShapes:  ReadonlyArray<Quad> | null;
}

/**
 * WeakMap from per-run context to its cache entry. Keyed by context identity
 * so concurrent runs (different contexts) never collide.
 *
 * @internal
 */
const cacheByContext = new WeakMap<PipelineContextInterface, ShapeCacheInterface>();

// ── onRunStart: config validation, shape preload, jt-absent detection ──────

TaskRegistry.registerHook(PLUGIN_NAME, 'onRunStart', async (ctx) => {
  const rawConfig = (ctx.config as Record<string, unknown>)['shaclShape'];
  if (rawConfig === undefined) {
    log.debug('onRunStart', 'no shaclShape config; plugin idle for this run');
    return;
  }

  // Validate the config fragment via the run-wide AJV.
  const validate = ctx.ajv.compile(SHACL_SHAPE_CONFIG_SCHEMA);
  if (!validate(rawConfig)) {
    const errors = validate.errors ?? [];
    const detail = errors.map(e => `${e.instancePath} ${e.message ?? ''}`.trim()).join('; ');
    throw SquashageConfigError.create(
      `classify:shacl-shape: invalid shaclShape config: ${detail}`,
      { metadata: { errors } },
    );
  }

  const config   = rawConfig as ShaclShapeClassifierConfigInterface;
  const priority = config.priority ?? DEFAULT_PRIORITY;

  // Ontology-mode jt-absent guard: no-op for the run, do NOT throw.
  if (config.shapesFrom === 'ontology' && ctx.jt === undefined) {
    log.warn(
      'onRunStart',
      'shapesFrom=ontology but ctx.jt is absent; classify:shacl-shape disabled for this run',
      { target: ctx.target },
    );
    cacheByContext.set(ctx, {
      disabled:   true,
      priority,
      shapesFrom: config.shapesFrom,
      fileShapes: null,
    });
    return;
  }

  // File-path mode: read + parse Turtle once at startup.
  if (config.shapesFrom !== 'ontology') {
    const schemasBase = (ctx.config as Record<string, unknown>)['__schemasBase'] as string | undefined
      ?? process.cwd();
    const absPath = resolvePath(schemasBase, config.shapesFrom);

    let text: string;
    try {
      text = readFileSync(absPath, 'utf-8');
    } catch (err) {
      const cause = err instanceof Error ? err : undefined;
      throw OutputConfigError.create(
        `classify:shacl-shape: cannot read shape file at ${absPath}: ${cause?.message ?? String(err)}`,
        { cause, metadata: { shapesFrom: config.shapesFrom, absPath } },
      );
    }

    const parsed = await Parser.parse(text, { format: 'turtle' });
    log.debug('onRunStart', 'Loaded shape file', { absPath, quadCount: parsed.quads.length });

    cacheByContext.set(ctx, {
      disabled:   false,
      priority,
      shapesFrom: config.shapesFrom,
      fileShapes: parsed.quads,
    });
    return;
  }

  // Ontology mode with jt present — no preload; per-record reads jt.shacl().
  cacheByContext.set(ctx, {
    disabled:   false,
    priority,
    shapesFrom: 'ontology',
    fileShapes: null,
  });

  log.debug('onRunStart', 'classify:shacl-shape primed', {
    target:     ctx.target,
    shapesFrom: config.shapesFrom,
    priority,
  });
});

// ── Per-record task ─────────────────────────────────────────────────────────

const shaclShapeTask: TaskFnInterface<PipelineStateInterface> = async (
  next:  NextFnInterface,
  state: PipelineStateInterface,
): Promise<void> => {
  const ctx = state.context;
  if (ctx === undefined) {
    // No context wired — the orchestrator always wires one in production, but
    // unit tests may invoke the task with a bare state. Mirror the historical
    // class behaviour: silent no-op.
    await next();
    return;
  }

  const entry = cacheByContext.get(ctx);
  if (entry === undefined) {
    // No `shaclShape` config for this run; nothing to do.
    await next();
    return;
  }

  if (entry.disabled) {
    // Optional-key no-op: ctx.jt was absent at startup. Per the contract the
    // disabled flag is final; never re-check ctx.jt here.
    await next();
    return;
  }

  // Resolve the shape graph: file-mode cached, ontology-mode pulled from jt.
  let allShapeQuads: ReadonlyArray<Quad>;
  if (entry.fileShapes !== null) {
    allShapeQuads = entry.fileShapes;
  } else {
    // Ontology mode — entry.disabled false implies ctx.jt is present.
    allShapeQuads = await ctx.jt!.shacl();
  }

  if (allShapeQuads.length === 0) {
    log.debug('execute', 'Shape graph is empty, no-op', { targetId: state.targetId });
    await next();
    return;
  }

  const shapes = ShaclShapeOps.extractNodeShapes(allShapeQuads);
  if (shapes.length === 0) {
    log.debug('execute', 'No NodeShapes found, no-op', { targetId: state.targetId });
    await next();
    return;
  }

  const proposals: ClassificationProposalInterface[] = [];

  for (const shape of shapes) {
    const className = ShaclShapeOps.resolveClassName(shape, ctx.jt);
    if (className === undefined) continue;

    const { shapesDataset, dataDataset } = ShaclShapeOps.buildValidationPair(shape, state.input);

    let report: Awaited<ReturnType<typeof ShaclGate.run>> | undefined;
    try {
      report = await ShaclGate.run(shapesDataset, dataDataset);
    } catch (err) {
      log.debug('execute', 'SHACL validation threw for shape', {
        targetId: state.targetId,
        shapeIri: shape.shapeIri,
        error:    err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    const targetClassIri = shape.targetClassIri ?? `urn:shape:${className}`;

    if (report.conforms) {
      proposals.push({
        source:     PLUGIN_NAME,
        className,
        priority:   entry.priority,
        confidence: 1,
        reasons: [
          `shacl:targetClass=${targetClassIri}`,
          'shacl:conforms=true',
        ],
      });
    }
  }

  if (proposals.length > 0) {
    (state as unknown as { classifications: ReadonlyArray<ClassificationProposalInterface> }).classifications = [
      ...state.classifications,
      ...proposals,
    ];
  }

  await next();
};

TaskRegistry.register(PLUGIN_NAME, shaclShapeTask, { proposesClass: true });

// ── Static-only helper class owning shape extraction and validation-pair build ─

/**
 * Module-private namespace owning the SHACL-shape parsing and validation-pair
 * construction logic. Static-only by design — no instances, no state. Mirrors
 * the private-method surface that `ShaclShapeClassifier` carries today, but
 * scoped to this plugin module so the class form remains the file-local
 * domain owner per the codebase convention against free helpers.
 *
 * @internal
 */
class ShaclShapeOps {
  // Private constructor: this class is a static-only namespace.
  private constructor() { /* static-only */ }

/**
 * Extracts all NodeShape descriptors from a flat array of shape quads.
 *
 * @internal
 */
static extractNodeShapes(quads: ReadonlyArray<Quad>): ReadonlyArray<NodeShapeDescriptorInterface> {
  const bySubject = new Map<string, Quad[]>();
  for (const q of quads) {
    const key = q.subject.value;
    const bucket = bySubject.get(key);
    if (bucket !== undefined) {
      bucket.push(q);
    } else {
      bySubject.set(key, [q]);
    }
  }

  const shapeIris = new Set<string>();
  for (const q of quads) {
    if (q.predicate.value === RDF_TYPE && q.object.value === SH_NODE_SHAPE) {
      shapeIris.add(q.subject.value);
    }
  }

  const descriptors: NodeShapeDescriptorInterface[] = [];

  for (const shapeIri of shapeIris) {
    let targetClassIri: string | undefined;
    const directQuads = bySubject.get(shapeIri) ?? [];
    const allShapeQuads: Quad[] = [...directQuads];
    const propertyPathIris: string[] = [];

    for (const q of directQuads) {
      if (q.predicate.value === SH_TARGET_CLASS) {
        targetClassIri = q.object.value;
      }

      if (q.predicate.value === SH_PROPERTY) {
        const propBnId = q.object.value;
        const propQuads = bySubject.get(propBnId) ?? [];
        for (const pq of propQuads) {
          allShapeQuads.push(pq);
          if (pq.predicate.value === SH_PATH) {
            propertyPathIris.push(pq.object.value);
          }
        }
      }
    }

    descriptors.push({ shapeIri, targetClassIri, allShapeQuads, propertyPathIris });
  }

  return descriptors;
}

/**
 * Resolves a class name string for a given NodeShape descriptor.
 *
 * @internal
 */
  static resolveClassName(
    shape: NodeShapeDescriptorInterface,
    jt:    JsonTologyOntology | undefined,
  ): string | undefined {
    if (shape.targetClassIri !== undefined) {
      return ShaclShapeOps.lastSegment(shape.targetClassIri);
    }

    if (jt !== undefined) {
      const classMap = jt.classMap();
      for (const [className] of Object.entries(classMap)) {
        const schema = jt.schemaForClassName(className);
        if (schema !== undefined && schema.$id === shape.shapeIri) {
          return className;
        }
      }
    }

    const derived = ShaclShapeOps.lastSegment(shape.shapeIri);
    return derived.length > 0 ? derived : undefined;
  }

  /**
   * Builds a validation pair: a shapes dataset augmented with `sh:targetNode`
   * and a data dataset projected from the record's properties via the shape's
   * property paths.
   *
   * @internal
   */
  static buildValidationPair(
    shape:  NodeShapeDescriptorInterface,
    record: Readonly<Record<string, unknown>>,
  ): { shapesDataset: ReturnType<typeof Dataset.from>; dataDataset: ReturnType<typeof Dataset.from> } {
    const RECORD_IRI = 'urn:record:0';
    const recordNode = dataFactory.namedNode(RECORD_IRI) as NamedNode;
    const defaultGraph = dataFactory.defaultGraph();
    const shapeNode    = dataFactory.namedNode(shape.shapeIri) as NamedNode;

    const shapeQuads: Quad[] = [...shape.allShapeQuads];

    if (shape.targetClassIri === undefined) {
      shapeQuads.push(
        dataFactory.quad(
          shapeNode,
          dataFactory.namedNode(SH_TARGET_NODE) as NamedNode,
          recordNode,
          defaultGraph,
        ) as unknown as Quad,
      );
    }

    const shapesDataset = Dataset.from(shapeQuads as Iterable<Quad>);

    const dataQuads: Quad[] = [];

    if (shape.targetClassIri !== undefined) {
      dataQuads.push(
        dataFactory.quad(
          recordNode,
          dataFactory.namedNode(RDF_TYPE) as NamedNode,
          dataFactory.namedNode(shape.targetClassIri) as NamedNode,
          defaultGraph,
        ) as unknown as Quad,
      );
    }

    for (const pathIri of shape.propertyPathIris) {
      const key = ShaclShapeOps.lastSegment(pathIri);
      if (key.length === 0) continue;

      const value = record[key];
      if (value === undefined || value === null) continue;

      let literal: ReturnType<typeof dataFactory.literal>;
      if (typeof value === 'number') {
        const isInt = Number.isInteger(value);
        literal = dataFactory.literal(
          String(value),
          dataFactory.namedNode(isInt ? `${XSD}integer` : `${XSD}decimal`) as NamedNode,
        );
      } else if (typeof value === 'boolean') {
        literal = dataFactory.literal(String(value), dataFactory.namedNode(`${XSD}boolean`) as NamedNode);
      } else {
        literal = dataFactory.literal(String(value));
      }

      dataQuads.push(
        dataFactory.quad(
          recordNode,
          dataFactory.namedNode(pathIri) as NamedNode,
          literal,
          defaultGraph,
        ) as unknown as Quad,
      );
    }

    const dataDataset = Dataset.from(dataQuads as Iterable<Quad>);
    return { shapesDataset, dataDataset };
  }

  /**
   * Returns the last `#`-fragment or `/`-segment from an IRI string.
   *
   * @internal
   */
  static lastSegment(iri: string): string {
    const hashIdx = iri.indexOf('#');
    if (hashIdx !== -1) {
      const fragment = iri.slice(hashIdx + 1);
      if (fragment.length > 0) return fragment;
    }
    const segment = iri.split('/').pop();
    return segment !== undefined ? segment : '';
  }
}
