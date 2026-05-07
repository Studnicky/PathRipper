/**
 * @fileoverview Unit tests for {@link SourceClassifier} and the
 * `classify:source` self-registering plugin.
 *
 * @remarks
 * Covers two surfaces in one file (per the v0.7.0 silo migration consolidation):
 *
 * 1. Legacy class form — constructor (no-arg), absent `_source` block, present
 *    `_source` with all fields, partial fields, proposal immutability,
 *    `next()` propagation, and additive accumulation when
 *    `state.classifications` is pre-populated.
 *
 * 2. Plugin form — self-registration on import (per-record task + onRunStart
 *    hook + manifest with `proposesClass: false`), AJV schema acceptance,
 *    `onRunStart` behaviour (absent namespace no-ops; valid namespace passes;
 *    invalid throws `ExternalSchemaError`), and per-record task behaviour via
 *    `TaskRegistry.get(SOURCE_TASK_NAME)`.
 *
 * @category Classification
 * @since 0.1.0
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

import AjvModule       from 'ajv';
import addFormatsModule from 'ajv-formats';

// Side-effect import: the canonical module both defines the legacy class AND
// self-registers the per-record task and onRunStart hook on the global
// TaskRegistry.
import {
  SourceClassifier,
  SOURCE_TASK_NAME,
  SOURCE_HOOK_NAME,
  sourceConfigSchema,
} from '../../../../src/classification/tasks/SourceClassifier.js';

import { TaskRegistry } from '../../../../src/registry/TaskRegistry.js';
import { ExternalSchemaError } from '../../../../src/errors/ExternalSchemaError.js';
import type {
  ClassificationProposalInterface,
  PipelineContextInterface,
  PipelineStateInterface,
} from '../../../../src/types/PipelineState.js';
import type { AjvCtorType, AddFormatsFnInterface } from '../../../../src/types/AjvInterop.js';

// ── AJV interop (dual-CJS/ESM default unwrap, matches src/context/ajv.ts) ──

const Ajv        = (AjvModule        as unknown as { default?: AjvCtorType }).default        ?? (AjvModule        as unknown as AjvCtorType);
const addFormats = (addFormatsModule as unknown as { default?: AddFormatsFnInterface }).default ?? (addFormatsModule as unknown as AddFormatsFnInterface);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Builds a minimal PipelineStateInterface for testing. */
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

// ── Legacy class tests ────────────────────────────────────────────────────────

describe('SourceClassifier — constructor', () => {
  it('constructs with no arguments', () => {
    const classifier = new SourceClassifier();
    assert.ok(classifier instanceof SourceClassifier);
  });

  it('exposes a bound execute function', () => {
    const classifier = new SourceClassifier();
    assert.strictEqual(typeof classifier.execute, 'function');
  });
});

describe('SourceClassifier — absent _source block', () => {
  it('emits no proposal when _source is absent', async () => {
    const classifier = new SourceClassifier();
    const state = buildState({ name: 'Bulbasaur' });
    const next = makeNext();

    await classifier.execute(next.fn, state);

    assert.strictEqual(state.classifications.length, 0);
  });

  it('calls next() when _source is absent', async () => {
    const classifier = new SourceClassifier();
    const state = buildState({ name: 'Bulbasaur' });
    const next = makeNext();

    await classifier.execute(next.fn, state);

    assert.strictEqual(next.called, true);
  });

  it('emits no proposal when _source is null', async () => {
    const classifier = new SourceClassifier();
    const state = buildState({ _source: null });
    const next = makeNext();

    await classifier.execute(next.fn, state);

    assert.strictEqual(state.classifications.length, 0);
  });

  it('emits no proposal when _source is a non-object (string)', async () => {
    const classifier = new SourceClassifier();
    const state = buildState({ _source: 'unexpected' });
    const next = makeNext();

    await classifier.execute(next.fn, state);

    assert.strictEqual(state.classifications.length, 0);
  });
});

describe('SourceClassifier — present _source block', () => {
  it('emits one proposal with className __source__ when _source is present', async () => {
    const classifier = new SourceClassifier();
    const state = buildState({
      _source: { target: 'aonprd', plugin: 'aonprd:parse', schemaId: 'feat-v1' },
    });
    const next = makeNext();

    await classifier.execute(next.fn, state);

    assert.strictEqual(state.classifications.length, 1);
    assert.strictEqual(state.classifications[0]?.className, '__source__');
  });

  it('emits proposal with source classify:source', async () => {
    const classifier = new SourceClassifier();
    const state = buildState({
      _source: { target: 'aonprd' },
    });
    const next = makeNext();

    await classifier.execute(next.fn, state);

    assert.strictEqual(state.classifications[0]?.source, 'classify:source');
  });

  it('emits proposal with priority 0 and confidence 1', async () => {
    const classifier = new SourceClassifier();
    const state = buildState({
      _source: { target: 'aonprd', plugin: 'aonprd:parse' },
    });
    const next = makeNext();

    await classifier.execute(next.fn, state);

    const proposal = state.classifications[0];
    assert.ok(proposal !== undefined);
    assert.strictEqual(proposal.priority, 0);
    assert.strictEqual(proposal.confidence, 1);
  });

  it('includes all three source fields in reasons when all are present', async () => {
    const classifier = new SourceClassifier();
    const state = buildState({
      _source: { target: 'aonprd', plugin: 'aonprd:parse', schemaId: 'feat-v1' },
    });
    const next = makeNext();

    await classifier.execute(next.fn, state);

    const reasons = state.classifications[0]?.reasons ?? [];
    assert.ok(reasons.includes('source.target=aonprd'), 'should include target');
    assert.ok(reasons.includes('source.plugin=aonprd:parse'), 'should include plugin');
    assert.ok(reasons.includes('source.schemaId=feat-v1'), 'should include schemaId');
  });

  it('omits plugin and schemaId from reasons when absent', async () => {
    const classifier = new SourceClassifier();
    const state = buildState({
      _source: { target: 'aonprd' },
    });
    const next = makeNext();

    await classifier.execute(next.fn, state);

    const reasons = state.classifications[0]?.reasons ?? [];
    assert.ok(reasons.includes('source.target=aonprd'), 'should include target');
    assert.strictEqual(reasons.filter((r) => r.startsWith('source.plugin=')).length, 0);
    assert.strictEqual(reasons.filter((r) => r.startsWith('source.schemaId=')).length, 0);
  });

  it('calls next() after emitting a proposal', async () => {
    const classifier = new SourceClassifier();
    const state = buildState({
      _source: { target: 'aonprd', plugin: 'aonprd:parse' },
    });
    const next = makeNext();

    await classifier.execute(next.fn, state);

    assert.strictEqual(next.called, true);
  });
});

describe('SourceClassifier — additive accumulation', () => {
  it('appends to existing classifications rather than replacing them', async () => {
    const classifier = new SourceClassifier();

    const existingProposal: ClassificationProposalInterface = {
      source:     'classify:structural',
      className:  'feat',
      priority:   10,
      confidence: 1,
      reasons:    ['_type=feat'],
    };

    const state = buildState(
      { _source: { target: 'aonprd' } },
      [existingProposal],
    );
    const next = makeNext();

    await classifier.execute(next.fn, state);

    assert.strictEqual(state.classifications.length, 2);
    assert.strictEqual(state.classifications[0], existingProposal);
    assert.strictEqual(state.classifications[1]?.className, '__source__');
  });
});

// ── Plugin tests ──────────────────────────────────────────────────────────────

describe('classify:source — self-registration on import', () => {
  it('registers the per-record task under classify:source', () => {
    assert.ok(TaskRegistry.has(SOURCE_TASK_NAME));
  });

  it('registers the onRunStart hook under classify:source', () => {
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

describe('classify:source — additive accumulation (plugin task)', () => {
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
