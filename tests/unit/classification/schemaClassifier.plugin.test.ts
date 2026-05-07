/**
 * @fileoverview Unit tests for the self-registering `classify:schema` plugin
 * surface (silo path, task #15).
 *
 * @remarks
 * Exercises the plugin module's `onRunStart` hook and per-record task by
 * driving them directly off the `TaskRegistry`. The hook compiles per-class
 * schemas via the SHARED `ctx.ajv` (matching the run-wide instance built by
 * `context:ajv`), and the task validates `state.input` against the cached
 * compiled validators.
 *
 * The legacy `SchemaClassifier` class continues to be tested in
 * `tests/unit/classification/tasks/SchemaClassifier.test.ts` — that surface
 * is preserved for the factory path during the v0.7.0 migration.
 *
 * @category Classification
 * @since 0.7.0
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import AjvModule        from 'ajv';
import addFormatsModule from 'ajv-formats';

import type { AjvCtorType, AddFormatsFnInterface } from '../../../src/types/AjvInterop.js';
import type { PipelineContextInterface, PipelineStateInterface } from '../../../src/types/PipelineState.js';
import { TaskRegistry } from '../../../src/registry/TaskRegistry.js';
import { OutputConfigError } from '../../../src/errors/OutputConfigError.js';

// Side-effect import: registers `classify:schema` (hook + task) on the
// global TaskRegistry.
import { __resetForTests as resetSchemaPluginCache } from '../../../src/classification/tasks/SchemaClassifier.js';

const Ajv        = (AjvModule        as unknown as { default?: AjvCtorType }).default        ?? (AjvModule        as unknown as AjvCtorType);
const addFormats = (addFormatsModule as unknown as { default?: AddFormatsFnInterface }).default ?? (addFormatsModule as unknown as AddFormatsFnInterface);

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildSharedAjv(): InstanceType<AjvCtorType> {
  // Mirrors `src/context/ajv.ts` configuration so this test exercises the
  // exact run-wide AJV the plugin will see in production.
  const ajv = new Ajv({ allErrors: true, strict: true, useDefaults: false });
  addFormats(ajv);
  return ajv;
}

function buildState(target: string, input: Record<string, unknown>): PipelineStateInterface {
  return {
    targetId:        target,
    source:          { target, path: 'fixture.json' },
    input,
    classification:  null,
    classifications: [],
    output:          null,
  };
}

async function runOnRunStart(name: string, ctx: PipelineContextInterface): Promise<void> {
  const hook = TaskRegistry.onRunStartHooks().find(([n]) => n === name);
  assert.ok(hook !== undefined, `expected ${name} hook to be registered`);
  await hook[1](ctx);
}

// ── Fixture: tmp dir holding two schema files ────────────────────────────────

let tmpDir:       string;
let featPath:     string;
let spellPath:    string;

before(() => {
  tmpDir    = mkdtempSync(joinPath(tmpdir(), 'schema-plugin-'));
  featPath  = joinPath(tmpDir, 'feat.schema.json');
  spellPath = joinPath(tmpDir, 'spell.schema.json');
  writeFileSync(featPath, JSON.stringify({
    type:       'object',
    properties: { _type: { const: 'feat' } },
    required:   ['_type'],
    additionalProperties: true,
  }));
  writeFileSync(spellPath, JSON.stringify({
    type:       'object',
    properties: { _type: { const: 'spell' } },
    required:   ['_type'],
    additionalProperties: true,
  }));
});

after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('classify:schema plugin — self-registration', () => {
  it('registers an onRunStart hook under the name "classify:schema"', () => {
    const names = TaskRegistry.onRunStartHooks().map(([n]) => n);
    assert.ok(names.includes('classify:schema'), `hooks: ${names.join(', ')}`);
  });

  it('registers a per-record task under the name "classify:schema"', () => {
    assert.ok(TaskRegistry.has('classify:schema'));
  });

  it('declares proposesClass: true in its task manifest', () => {
    const manifest = TaskRegistry.manifests().find(m => m.name === 'classify:schema' && m.phase === undefined);
    assert.ok(manifest !== undefined, 'expected per-record manifest for classify:schema');
    assert.equal(manifest.proposesClass, true);
  });
});

describe('classify:schema plugin — onRunStart compiles via ctx.ajv', () => {
  it('compiles each per-class schema against the SHARED ctx.ajv', async () => {
    resetSchemaPluginCache();

    const ajv: InstanceType<AjvCtorType> = buildSharedAjv();
    const ctx = {
      target: 'unit-shared',
      outDir: './graphs',
      config: {
        schemas: [
          { className: 'feat',  priority: 10, schemaPath: 'feat.schema.json' },
          { className: 'spell', priority:  9, schemaPath: 'spell.schema.json' },
        ],
        __schemasBase: tmpDir,
      },
      ajv,
    } as unknown as PipelineContextInterface;

    await runOnRunStart('classify:schema', ctx);

    // Per-record dispatch: should match the feat record.
    const featState  = buildState('unit-shared', { _type: 'feat',  name: 'Power Attack' });
    const spellState = buildState('unit-shared', { _type: 'spell', name: 'Magic Missile' });
    const taskFn     = TaskRegistry.get('classify:schema');

    let nextCount = 0;
    const next = async (): Promise<void> => { nextCount += 1; };

    await taskFn(next, featState);
    await taskFn(next, spellState);

    assert.equal(nextCount, 2, 'next() called once per record');

    assert.equal(featState.classifications.length, 1);
    assert.equal(featState.classifications[0]?.source,    'classify:schema');
    assert.equal(featState.classifications[0]?.className, 'feat');
    assert.equal(featState.classifications[0]?.priority,  10);

    assert.equal(spellState.classifications.length, 1);
    assert.equal(spellState.classifications[0]?.className, 'spell');
    assert.equal(spellState.classifications[0]?.priority,   9);
  });

  it('passes through silently when the target has no schemas configured', async () => {
    resetSchemaPluginCache();

    const ajv = buildSharedAjv();
    const ctx = {
      target: 'unit-empty',
      outDir: './graphs',
      config: {},
      ajv,
    } as unknown as PipelineContextInterface;

    await runOnRunStart('classify:schema', ctx);

    const state  = buildState('unit-empty', { _type: 'feat' });
    const taskFn = TaskRegistry.get('classify:schema');
    let nextCalled = false;
    await taskFn(async () => { nextCalled = true; }, state);

    assert.equal(nextCalled, true, 'next() must be called even when plugin disabled');
    assert.deepEqual(state.classifications, []);
  });

  it('fail-fasts with OutputConfigError when config namespace is invalid', async () => {
    resetSchemaPluginCache();

    const ajv = buildSharedAjv();
    const ctx = {
      target: 'unit-bad-config',
      outDir: './graphs',
      config: {
        schemas: [
          // Missing required `priority`.
          { className: 'feat', schemaPath: 'feat.schema.json' },
        ],
        __schemasBase: tmpDir,
      },
      ajv,
    } as unknown as PipelineContextInterface;

    await assert.rejects(
      () => runOnRunStart('classify:schema', ctx),
      (err: unknown) => {
        assert.ok(err instanceof OutputConfigError);
        assert.match((err as Error).message, /classify:schema/);
        assert.match((err as Error).message, /priority/);
        return true;
      },
    );
  });

  it('fail-fasts with OutputConfigError when a schema file is missing', async () => {
    resetSchemaPluginCache();

    const ajv = buildSharedAjv();
    const ctx = {
      target: 'unit-missing-file',
      outDir: './graphs',
      config: {
        schemas: [
          { className: 'feat', priority: 10, schemaPath: 'does-not-exist.schema.json' },
        ],
        __schemasBase: tmpDir,
      },
      ajv,
    } as unknown as PipelineContextInterface;

    await assert.rejects(
      () => runOnRunStart('classify:schema', ctx),
      (err: unknown) => {
        assert.ok(err instanceof OutputConfigError);
        assert.match((err as Error).message, /cannot read schema file/);
        return true;
      },
    );
  });

  it('compiles user schemas onto the SAME ctx.ajv (compile is observable on the shared instance)', async () => {
    // This test pins the contract: the plugin uses ctx.ajv.compile, NOT a
    // private AJV. Proxy-instrument the shared ajv.compile so we can count
    // calls flowing through the plugin.
    resetSchemaPluginCache();

    const ajv = buildSharedAjv();
    let compileCalls = 0;
    const realCompile = ajv.compile.bind(ajv);
    ajv.compile = ((schema: object) => {
      compileCalls += 1;
      return realCompile(schema);
    }) as typeof ajv.compile;

    const ctx = {
      target: 'unit-shared-compile',
      outDir: './graphs',
      config: {
        schemas: [
          { className: 'feat',  priority: 10, schemaPath: 'feat.schema.json' },
          { className: 'spell', priority:  9, schemaPath: 'spell.schema.json' },
        ],
        __schemasBase: tmpDir,
      },
      ajv,
    } as unknown as PipelineContextInterface;

    await runOnRunStart('classify:schema', ctx);

    // One compile for the config schema fragment + one per per-class schema = 3.
    assert.ok(compileCalls >= 3, `expected ≥3 ctx.ajv.compile calls, saw ${compileCalls.toString()}`);
  });
});
