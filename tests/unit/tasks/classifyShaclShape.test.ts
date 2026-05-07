/**
 * @fileoverview Unit tests for the `classify:shacl-shape` self-registering plugin.
 *
 * @remarks
 * Asserts the plugin's lifecycle + per-record contract per task #18:
 *
 * - Self-registers BOTH an `onRunStart` hook AND a per-record task under the
 *   single name `classify:shacl-shape`, with the per-record manifest carrying
 *   `proposesClass: true`.
 * - Lifecycle hook validates `ctx.config.shaclShape` against the plugin's AJV
 *   schema fragment via `ctx.ajv` and fails fast on shape mismatch.
 * - Optional-jt no-op contract:
 *     * `shapesFrom: 'ontology'` + `ctx.jt === undefined` -> startup logs warning
 *       and primes a `disabled: true` cache; per-record dispatch is a silent
 *       no-op (next() called, no proposals, no exception).
 * - File-path mode: shapes parsed once at startup, cached for per-record use.
 * - Ontology mode with `ctx.jt` present: per-record proposals carry the right
 *   `className`, `priority`, `confidence` and reasons.
 *
 * @module tests/unit/plugins/classification/shaclShape
 * @category Classification
 * @since 0.7.0
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Side-effect import — registers the run-wide AJV under TaskRegistry hook
// `context:ajv`, so the test can prime a stub context with a real AJV before
// invoking the plugin's hook.
import '../../../src/context/ajv.js';

// Side-effect import — registers the plugin under test.
import {
  PLUGIN_NAME,
  SHACL_SHAPE_CONFIG_SCHEMA,
} from '../../../src/tasks/classifyShaclShape.js';

import { TaskRegistry } from '../../../src/registry/TaskRegistry.js';
import { JsonTologyOntology } from '../../../src/ontology/JsonTologyOntology.js';
import { Logger } from '../../../src/modules/logger/logger.js';
import { SquashageConfigError } from '../../../src/errors/SquashageConfigError.js';
import type {
  PipelineContextInterface,
  PipelineStateInterface,
  ClassificationProposalInterface,
} from '../../../src/types/PipelineState.js';

// ── Inline schemas ───────────────────────────────────────────────────────────

const WIDGET_SCHEMA = {
  '$id':     'https://squashage.dev/schemas/test/widget',
  title:     'Widget',
  '$schema': 'http://json-schema.org/draft-07/schema#',
  type:      'object',
  properties: {
    name: { type: 'string' },
    sku:  { type: 'string' },
  },
  required: ['name'],
} as const;

// ── Turtle shape fixture ─────────────────────────────────────────────────────

const PERSON_SHAPE_TURTLE = `
@prefix sh:  <http://www.w3.org/ns/shacl#> .
@prefix ex:  <https://example.org/> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

ex:PersonShape a sh:NodeShape ;
  sh:targetClass ex:Person ;
  sh:property [
    sh:path ex:name ;
    sh:datatype xsd:string ;
    sh:minCount 1 ;
  ] .
`.trim();

// ── Stub context builder ─────────────────────────────────────────────────────

interface StubContextInterface extends Partial<PipelineContextInterface> {
  target: string;
  outDir: string;
  config: Record<string, unknown>;
}

async function primeStub(stub: StubContextInterface): Promise<void> {
  // Run only the context:ajv hook so ctx.ajv is populated.
  for (const [name, fn] of TaskRegistry.onRunStartHooks()) {
    if (name === 'context:ajv') {
      await fn(stub as unknown as PipelineContextInterface);
    }
  }
}

async function runShaclShapeHook(stub: StubContextInterface): Promise<void> {
  for (const [name, fn] of TaskRegistry.onRunStartHooks()) {
    if (name === PLUGIN_NAME) {
      await fn(stub as unknown as PipelineContextInterface);
      return;
    }
  }
  throw new Error('classify:shacl-shape hook is not registered');
}

function buildState(
  input: Record<string, unknown>,
  ctx?:  PipelineContextInterface,
  existingProposals: ReadonlyArray<ClassificationProposalInterface> = [],
): PipelineStateInterface {
  return {
    targetId:        'unit-target',
    source:          { target: 'unit-target', path: 'fixture.json' },
    input,
    classification:  null,
    classifications: existingProposals,
    output:          null,
    context:         ctx,
  };
}

// ── Suite: registration manifest ─────────────────────────────────────────────

describe('classify:shacl-shape — self-registration', () => {
  it('registers both an onRunStart hook and a per-record task under classify:shacl-shape', () => {
    const hookNames = TaskRegistry.onRunStartHooks().map(([n]) => n);
    assert.ok(hookNames.includes(PLUGIN_NAME), `expected ${PLUGIN_NAME} in onRunStart hooks`);

    assert.ok(TaskRegistry.has(PLUGIN_NAME), `expected ${PLUGIN_NAME} per-record task`);
  });

  it('per-record manifest declares proposesClass: true', () => {
    const manifest = TaskRegistry.manifests().find(m => m.name === PLUGIN_NAME && m.phase === undefined);
    assert.ok(manifest, 'expected a per-record manifest entry (no phase)');
    assert.equal(manifest.proposesClass, true);
  });
});

// ── Suite: optional-jt no-op contract (REQUIRED by silo contract) ──────────

describe('classify:shacl-shape — optional-jt no-op contract', () => {
  // This is the load-bearing test for the silo contract: when
  // shapesFrom === 'ontology' and ctx.jt is absent, the hook MUST mark the run
  // as disabled (no throw), and per-record dispatch MUST be a silent no-op.
  it('hook with shapesFrom=ontology and ctx.jt absent does not throw, primes disabled state', async () => {
    const stub: StubContextInterface = {
      target: 'unit',
      outDir: '/tmp',
      config: { shaclShape: { shapesFrom: 'ontology', priority: 45 } },
      logger: Logger,
    };
    await primeStub(stub);
    // ctx.jt deliberately undefined.
    await assert.doesNotReject(runShaclShapeHook(stub),
      'hook MUST NOT throw when ctx.jt is absent in ontology mode');
  });

  it('per-record task is a silent no-op when the run was disabled at startup', async () => {
    const stub: StubContextInterface = {
      target: 'unit',
      outDir: '/tmp',
      config: { shaclShape: { shapesFrom: 'ontology', priority: 45 } },
      logger: Logger,
    };
    await primeStub(stub);
    await runShaclShapeHook(stub);

    const task = TaskRegistry.get(PLUGIN_NAME);
    const state = buildState({ name: 'whatever' }, stub as unknown as PipelineContextInterface);

    let nextCalled = false;
    await task(async () => { nextCalled = true; }, state);

    assert.equal(nextCalled, true, 'next() must be called even with no jt');
    assert.deepEqual(state.classifications, [], 'no proposals when run is disabled');
  });

  it('hook with shapesFrom=ontology and ctx.jt present primes a non-disabled cache', async () => {
    const jt = JsonTologyOntology.create({
      baseIRI: 'https://squashage.dev/vocabulary/test',
      schemas: [
        { schemaPath: 'widget.schema.json', schema: WIDGET_SCHEMA as unknown as Record<string, unknown> & { readonly '$id': string } },
      ],
    });

    const stub: StubContextInterface = {
      target: 'unit',
      outDir: '/tmp',
      config: { shaclShape: { shapesFrom: 'ontology', priority: 45 } },
      logger: Logger,
      jt,
    };
    await primeStub(stub);
    await runShaclShapeHook(stub);

    const task = TaskRegistry.get(PLUGIN_NAME);
    const state = buildState({ name: 'Sprocket', sku: 'W-001' }, stub as unknown as PipelineContextInterface);

    await task(async () => { /* noop */ }, state);

    assert.equal(state.classifications.length, 1, 'expected one proposal from the Widget shape');
    const [p] = state.classifications;
    assert.ok(p);
    assert.equal(p.source,    PLUGIN_NAME);
    assert.equal(p.className, 'Widget');
    assert.equal(p.priority,  45);
    assert.equal(p.confidence, 1);
    assert.ok(p.reasons.some(r => r.includes('shacl:conforms=true')));
  });
});

// ── Suite: AJV config validation at onRunStart ──────────────────────────────

describe('classify:shacl-shape — onRunStart config validation', () => {
  it('throws SquashageConfigError when shapesFrom is missing', async () => {
    const stub: StubContextInterface = {
      target: 'unit',
      outDir: '/tmp',
      config: { shaclShape: { /* missing shapesFrom */ priority: 45 } as Record<string, unknown> },
      logger: Logger,
    };
    await primeStub(stub);

    await assert.rejects(
      runShaclShapeHook(stub),
      (err: unknown) => {
        assert.ok(err instanceof SquashageConfigError, `Expected SquashageConfigError, got ${String(err)}`);
        return true;
      },
    );
  });

  it('throws SquashageConfigError on additional properties', async () => {
    const stub: StubContextInterface = {
      target: 'unit',
      outDir: '/tmp',
      config: { shaclShape: { shapesFrom: 'ontology', bogus: 1 } },
      logger: Logger,
    };
    await primeStub(stub);

    await assert.rejects(
      runShaclShapeHook(stub),
      (err: unknown) => err instanceof SquashageConfigError,
    );
  });

  it('no shaclShape config -> hook is idle (no throw, no cache primed)', async () => {
    const stub: StubContextInterface = {
      target: 'unit',
      outDir: '/tmp',
      config: {},
      logger: Logger,
    };
    await primeStub(stub);
    await assert.doesNotReject(runShaclShapeHook(stub));

    // Per-record task with no cache primed: silent no-op.
    const task = TaskRegistry.get(PLUGIN_NAME);
    const state = buildState({ name: 'x' }, stub as unknown as PipelineContextInterface);
    let nextCalled = false;
    await task(async () => { nextCalled = true; }, state);
    assert.equal(nextCalled, true);
    assert.deepEqual(state.classifications, []);
  });

  it('exports the AJV schema fragment as a plain object', () => {
    assert.equal(typeof SHACL_SHAPE_CONFIG_SCHEMA, 'object');
    assert.equal((SHACL_SHAPE_CONFIG_SCHEMA as { type: string }).type, 'object');
  });
});

// ── Suite: file-path mode end-to-end ────────────────────────────────────────

describe('classify:shacl-shape — file-path mode', () => {
  let shapePath = '';

  before(async () => {
    shapePath = join(tmpdir(), `plugin-shacl-test-${Date.now().toString()}.ttl`);
    await writeFile(shapePath, PERSON_SHAPE_TURTLE, 'utf-8');
  });

  after(async () => {
    await unlink(shapePath).catch(() => { /* ignore */ });
  });

  it('hook parses Turtle once at startup; per-record task validates against cached shapes', async () => {
    const stub: StubContextInterface = {
      target: 'unit',
      outDir: '/tmp',
      // __schemasBase bridge key keeps the same convention as task #11's ontology hook.
      config: { shaclShape: { shapesFrom: shapePath, priority: 45 }, __schemasBase: '/' },
      logger: Logger,
    };
    await primeStub(stub);
    await runShaclShapeHook(stub);

    const task = TaskRegistry.get(PLUGIN_NAME);
    const state = buildState({ name: 'Alice' }, stub as unknown as PipelineContextInterface);

    let nextCalled = false;
    await task(async () => { nextCalled = true; }, state);
    assert.equal(nextCalled, true);

    assert.equal(state.classifications.length, 1);
    const [p] = state.classifications;
    assert.ok(p);
    assert.equal(p.source,    PLUGIN_NAME);
    assert.equal(p.className, 'Person');
    assert.equal(p.priority,  45);
    assert.ok(p.reasons.some(r => r.includes('shacl:conforms=true')));
  });
});
