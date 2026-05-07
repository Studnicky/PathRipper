/**
 * @fileoverview Unit tests for the `classify:source` self-registering plugin.
 *
 * @remarks
 * Covers four surfaces:
 *
 * 1. Self-registration on import — both the per-record task and the
 *    `context:source-classifier` `onRunStart` hook appear in the global
 *    `TaskRegistry` after the side-effect import resolves, with the manifest
 *    declaring `proposesClass: false`.
 * 2. AJV schema acceptance — `true` validates; `false`, strings, objects,
 *    and `null` fail.
 * 3. `onRunStart` behaviour — absent namespace no-ops; present-and-valid
 *    namespace passes; present-and-invalid throws `ExternalSchemaError`.
 * 4. Per-record task behaviour — equivalent to the legacy
 *    `SourceClassifier` test suite (absent `_source`, present `_source`,
 *    additive accumulation), since the plugin will replace the class once
 *    task #24 rewires the orchestrator.
 *
 * Mirrors the conventions used in
 * `tests/unit/context/lifecycle.test.ts` (side-effect import, single global
 * `TaskRegistry`, no `reset()` between describe blocks).
 *
 * @category Classification
 * @since 0.7.0
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

import AjvModule       from 'ajv';
import addFormatsModule from 'ajv-formats';

// Side-effect import: registers the per-record task and onRunStart hook on
// the global TaskRegistry. We import once at module load; subsequent test
// files that import the plugin again hit Node's ESM cache and reuse the
// same registrations without firing the side effects twice.
import {
  SOURCE_TASK_NAME,
  SOURCE_HOOK_NAME,
  sourceConfigSchema,
} from '../../../src/classification/source.js';

import { TaskRegistry } from '../../../src/registry/TaskRegistry.js';
import { ExternalSchemaError } from '../../../src/errors/ExternalSchemaError.js';
import type {
  ClassificationProposalInterface,
  PipelineContextInterface,
  PipelineStateInterface,
} from '../../../src/types/PipelineState.js';
import type { AjvCtorType, AddFormatsFnInterface } from '../../../src/types/AjvInterop.js';

// ── AJV interop (dual-CJS/ESM default unwrap, matches src/context/ajv.ts) ──

const Ajv        = (AjvModule        as unknown as { default?: AjvCtorType }).default        ?? (AjvModule        as unknown as AjvCtorType);
const addFormats = (addFormatsModule as unknown as { default?: AddFormatsFnInterface }).default ?? (addFormatsModule as unknown as AddFormatsFnInterface);

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Builds a minimal PipelineStateInterface for per-record-task tests. */
function buildState(
  input:           Readonly<Record<string, unknown>> = {},
  classifications: ReadonlyArray<ClassificationProposalInterface> = [],
): PipelineStateInterface {
  return {
    targetId:        'test-target',
    source:          { target: 'test-target', path: 'fixture.json' },
    input,
    classification:  null,
    classifications,
    output:          null,
  };
}

/** Tracks whether `next()` was called; check `.called` after execution. */
function makeNext(): { called: boolean; fn: () => Promise<void> } {
  const handle = { called: false, fn: async (): Promise<void> => { handle.called = true; } };
  return handle;
}

/**
 * Builds a context stub with the run-wide AJV instance the onRunStart hook
 * needs, plus a configurable `config` slot for the namespace under test.
 */
function buildCtx(config: Record<string, unknown> = {}): PipelineContextInterface {
  const ajv = new Ajv({ allErrors: true, strict: true, useDefaults: false });
  addFormats(ajv);
  return {
    target: 'test-target',
    config,
    ajv,
    // Other slots are not read by classify:source's onRunStart; supply
    // permissive stubs so the type checks pass.
  } as unknown as PipelineContextInterface;
}

/** Locate the registered onRunStart hook by name; throws if not present. */
function getSourceHook(): (ctx: PipelineContextInterface) => Promise<void> | void {
  for (const [name, fn] of TaskRegistry.onRunStartHooks()) {
    if (name === SOURCE_HOOK_NAME) return fn;
  }
  throw new Error(`hook ${SOURCE_HOOK_NAME} not registered`);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('classify:source — self-registration on import', () => {
  it('registers the per-record task under classify:source', () => {
    assert.ok(TaskRegistry.has(SOURCE_TASK_NAME));
  });

  it('registers the onRunStart hook under context:source-classifier', () => {
    const names = TaskRegistry.onRunStartHooks().map(([n]) => n);
    assert.ok(names.includes(SOURCE_HOOK_NAME));
  });

  it('declares proposesClass: false in the manifest', () => {
    const manifest = TaskRegistry.manifests().find((m) => m.name === SOURCE_TASK_NAME);
    assert.ok(manifest);
    assert.equal(manifest.proposesClass, false);
  });
});

describe('classify:source — AJV schema acceptance', () => {
  const ajv = new Ajv({ allErrors: true, strict: true, useDefaults: false });
  addFormats(ajv);
  const validate = ajv.compile(sourceConfigSchema);

  it('accepts the literal true', () => {
    assert.equal(validate(true), true);
  });

  it('rejects false', () => {
    assert.equal(validate(false), false);
  });

  it('rejects strings', () => {
    assert.equal(validate('true'), false);
  });

  it('rejects objects', () => {
    assert.equal(validate({}), false);
  });

  it('rejects null', () => {
    assert.equal(validate(null), false);
  });

  it('rejects numbers', () => {
    assert.equal(validate(1), false);
  });
});

describe('classify:source — onRunStart hook', () => {
  it('no-ops when ctx.config.source is absent', async () => {
    const hook = getSourceHook();
    const ctx  = buildCtx({ /* no source key */ });
    // Should not throw; absent namespace is the legacy-coexistence path.
    await hook(ctx);
    assert.ok(true);
  });

  it('passes when ctx.config.source is true', async () => {
    const hook = getSourceHook();
    const ctx  = buildCtx({ source: true });
    await hook(ctx);
    assert.ok(true);
  });

  it('throws ExternalSchemaError when ctx.config.source is false', async () => {
    const hook = getSourceHook();
    const ctx  = buildCtx({ source: false });
    await assert.rejects(async () => hook(ctx), ExternalSchemaError);
  });

  it('throws ExternalSchemaError when ctx.config.source is a string', async () => {
    const hook = getSourceHook();
    const ctx  = buildCtx({ source: 'true' });
    await assert.rejects(async () => hook(ctx), ExternalSchemaError);
  });

  it('throws ExternalSchemaError when ctx.config.source is an object', async () => {
    const hook = getSourceHook();
    const ctx  = buildCtx({ source: { foo: 'bar' } });
    await assert.rejects(async () => hook(ctx), ExternalSchemaError);
  });
});

describe('classify:source — per-record task: absent _source', () => {
  let task: ReturnType<typeof TaskRegistry.get>;
  before(() => { task = TaskRegistry.get(SOURCE_TASK_NAME); });

  it('emits no proposal when _source is absent', async () => {
    const state = buildState({ name: 'Power Attack' });
    const next  = makeNext();
    await task(next.fn, state);
    assert.equal(state.classifications.length, 0);
  });

  it('calls next() when _source is absent', async () => {
    const state = buildState({ name: 'Power Attack' });
    const next  = makeNext();
    await task(next.fn, state);
    assert.equal(next.called, true);
  });

  it('emits no proposal when _source is null', async () => {
    const state = buildState({ _source: null });
    const next  = makeNext();
    await task(next.fn, state);
    assert.equal(state.classifications.length, 0);
  });

  it('emits no proposal when _source is a string', async () => {
    const state = buildState({ _source: 'unexpected' });
    const next  = makeNext();
    await task(next.fn, state);
    assert.equal(state.classifications.length, 0);
  });

  it('emits no proposal when _source is an array', async () => {
    const state = buildState({ _source: ['a', 'b'] });
    const next  = makeNext();
    await task(next.fn, state);
    assert.equal(state.classifications.length, 0);
  });
});

describe('classify:source — per-record task: present _source', () => {
  let task: ReturnType<typeof TaskRegistry.get>;
  before(() => { task = TaskRegistry.get(SOURCE_TASK_NAME); });

  it('emits one __source__ proposal when _source is present', async () => {
    const state = buildState({
      _source: { target: 'aonprd', plugin: 'aonprd:parse', schemaId: 'feat-v1' },
    });
    const next = makeNext();
    await task(next.fn, state);
    assert.equal(state.classifications.length, 1);
    assert.equal(state.classifications[0]?.className, '__source__');
  });

  it('uses classify:source as the proposal source', async () => {
    const state = buildState({ _source: { target: 'aonprd' } });
    const next  = makeNext();
    await task(next.fn, state);
    assert.equal(state.classifications[0]?.source, 'classify:source');
  });

  it('sets priority 0 and confidence 1 on the proposal', async () => {
    const state = buildState({ _source: { target: 'aonprd', plugin: 'aonprd:parse' } });
    const next  = makeNext();
    await task(next.fn, state);
    const proposal = state.classifications[0];
    assert.ok(proposal);
    assert.equal(proposal.priority,   0);
    assert.equal(proposal.confidence, 1);
  });

  it('builds reasons from each present source field', async () => {
    const state = buildState({
      _source: { target: 'aonprd', plugin: 'aonprd:parse', schemaId: 'feat-v1' },
    });
    const next = makeNext();
    await task(next.fn, state);
    const reasons = state.classifications[0]?.reasons ?? [];
    assert.ok(reasons.includes('source.target=aonprd'));
    assert.ok(reasons.includes('source.plugin=aonprd:parse'));
    assert.ok(reasons.includes('source.schemaId=feat-v1'));
  });

  it('omits absent fields from reasons', async () => {
    const state = buildState({ _source: { target: 'aonprd' } });
    const next  = makeNext();
    await task(next.fn, state);
    const reasons = state.classifications[0]?.reasons ?? [];
    assert.equal(reasons.filter((r) => r.startsWith('source.plugin=')).length,   0);
    assert.equal(reasons.filter((r) => r.startsWith('source.schemaId=')).length, 0);
  });

  it('calls next() after emitting a proposal', async () => {
    const state = buildState({ _source: { target: 'aonprd' } });
    const next  = makeNext();
    await task(next.fn, state);
    assert.equal(next.called, true);
  });
});

describe('classify:source — additive accumulation', () => {
  let task: ReturnType<typeof TaskRegistry.get>;
  before(() => { task = TaskRegistry.get(SOURCE_TASK_NAME); });

  it('appends to existing classifications rather than replacing them', async () => {
    const existing: ClassificationProposalInterface = {
      source:     'classify:structural',
      className:  'feat',
      priority:   10,
      confidence: 1,
      reasons:    ['_type=feat'],
    };
    const state = buildState({ _source: { target: 'aonprd' } }, [existing]);
    const next  = makeNext();
    await task(next.fn, state);
    assert.equal(state.classifications.length, 2);
    assert.equal(state.classifications[0],          existing);
    assert.equal(state.classifications[1]?.className, '__source__');
  });
});
