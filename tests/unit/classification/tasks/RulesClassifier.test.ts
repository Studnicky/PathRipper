/**
 * @fileoverview Unit tests for {@link RulesClassifier}.
 *
 * @remarks
 * Covers: constructor validation (empty rules throws), frozen-rules invariant,
 * no-match case, single-match case, multi-match case (multiple proposals),
 * `next()` always called, and additive accumulation.
 *
 * Uses {@link Predicate.compile} to build test rules — ensures end-to-end
 * coverage with the C1 engine.
 *
 * @category Classification
 * @since 0.1.0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import AjvModule from 'ajv';

import { RulesClassifier } from '../../../../src/classification/tasks/RulesClassifier.js';
import type { RuleEntryInterface } from '../../../../src/classification/tasks/RulesClassifier.js';
import { Predicate } from '../../../../src/classification/predicates/Predicate.js';
import { OutputConfigError } from '../../../../src/errors/OutputConfigError.js';
import { TaskRegistry } from '../../../../src/registry/TaskRegistry.js';
import type {
  PipelineContextInterface,
  PipelineStateInterface,
  ClassificationProposalInterface,
} from '../../../../src/types/PipelineState.js';
import type { AjvCtorType } from '../../../../src/types/AjvInterop.js';

// AJV 8.x dual-CJS/ESM; mirror the unwrap idiom used throughout the codebase.
const Ajv = (AjvModule as unknown as { default?: AjvCtorType }).default
  ?? (AjvModule as unknown as AjvCtorType);

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
 * A compound rule: matches records where `_type` is `'feat'` AND `level`
 * is a number.
 */
const gen1FeatRule: RuleEntryInterface = {
  className: 'gen1-feat',
  priority:  20,
  predicate: Predicate.compile({
    all: [
      { path: '/_type', equals: 'feat' },
      { path: '/level', type: 'number' },
    ],
  }),
  reasons: ['_type=feat', 'level present'],
};

/** Matches any record where `_type` is `'feat'`. */
const anyFeatRule: RuleEntryInterface = {
  className: 'feat',
  priority:  10,
  predicate: Predicate.compile({ path: '/_type', equals: 'feat' }),
  reasons:   ['_type=feat'],
};

/** Matches records where `_type` is `'monster'`. */
const monsterRule: RuleEntryInterface = {
  className: 'monster',
  priority:  10,
  predicate: Predicate.compile({ path: '/_type', equals: 'monster' }),
  reasons:   ['_type=monster'],
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RulesClassifier — constructor', () => {
  it('constructs successfully with at least one rule', () => {
    const classifier = new RulesClassifier([anyFeatRule]);
    assert.ok(classifier instanceof RulesClassifier);
  });

  it('throws OutputConfigError when rules array is empty', () => {
    assert.throws(
      () => new RulesClassifier([]),
      (err: unknown) => {
        assert.ok(err instanceof OutputConfigError, `Expected OutputConfigError, got ${String(err)}`);
        assert.match(err.message, /at least one rule/);
        return true;
      },
    );
  });

  it('exposes a bound execute function', () => {
    const classifier = new RulesClassifier([anyFeatRule]);
    assert.strictEqual(typeof classifier.execute, 'function');
  });

  it('frozen-rules invariant: mutating the input array after construction has no effect', async () => {
    const mutableRules: RuleEntryInterface[] = [anyFeatRule];
    const classifier = new RulesClassifier(mutableRules);

    // Push a monster rule into the original array after construction.
    mutableRules.push(monsterRule);

    // A monster record should NOT match anyFeatRule; if the internal array
    // referenced the mutable original it would now also evaluate monsterRule.
    const state = buildState({ _type: 'monster' });
    const next = makeNext();

    await classifier.execute(next.fn, state);

    // Only anyFeatRule is in the frozen internal copy; it does not match
    // { _type: 'monster' }, so zero proposals should be emitted.
    assert.strictEqual(state.classifications.length, 0);
  });
});

describe('RulesClassifier — no match', () => {
  it('emits no proposals when no rule matches', async () => {
    const classifier = new RulesClassifier([anyFeatRule, monsterRule]);
    const state = buildState({ _type: 'item' });
    const next = makeNext();

    await classifier.execute(next.fn, state);

    assert.strictEqual(state.classifications.length, 0);
  });

  it('calls next() even when no rule matches', async () => {
    const classifier = new RulesClassifier([anyFeatRule]);
    const state = buildState({ _type: 'item' });
    const next = makeNext();

    await classifier.execute(next.fn, state);

    assert.strictEqual(next.called, true);
  });
});

describe('RulesClassifier — single match', () => {
  it('emits one proposal when exactly one rule matches', async () => {
    const classifier = new RulesClassifier([anyFeatRule, monsterRule]);
    const state = buildState({ _type: 'feat', rarity: 'common' });
    const next = makeNext();

    await classifier.execute(next.fn, state);

    assert.strictEqual(state.classifications.length, 1);
  });

  it('emitted proposal carries source classify:rules', async () => {
    const classifier = new RulesClassifier([anyFeatRule]);
    const state = buildState({ _type: 'feat', level: 1 });
    const next = makeNext();

    await classifier.execute(next.fn, state);

    assert.strictEqual(state.classifications[0]?.source, 'classify:rules');
  });

  it('emitted proposal carries correct className, priority, confidence, and reasons', async () => {
    const classifier = new RulesClassifier([gen1FeatRule]);
    const state = buildState({ _type: 'feat', level: 1 });
    const next = makeNext();

    await classifier.execute(next.fn, state);

    const proposal = state.classifications[0];
    assert.ok(proposal !== undefined);
    assert.strictEqual(proposal.className,  'gen1-feat');
    assert.strictEqual(proposal.priority,   20);
    assert.strictEqual(proposal.confidence, 1);
    assert.deepStrictEqual(proposal.reasons, ['_type=feat', 'level present']);
  });

  it('calls next() after emitting a proposal', async () => {
    const classifier = new RulesClassifier([anyFeatRule]);
    const state = buildState({ _type: 'feat' });
    const next = makeNext();

    await classifier.execute(next.fn, state);

    assert.strictEqual(next.called, true);
  });
});

describe('RulesClassifier — multi match', () => {
  it('emits one proposal per matching rule when both rules match the same record', async () => {
    // gen1FeatRule (level present) AND anyFeatRule (_type=feat) both match.
    const classifier = new RulesClassifier([gen1FeatRule, anyFeatRule, monsterRule]);
    const state = buildState({ _type: 'feat', level: 1 });
    const next = makeNext();

    await classifier.execute(next.fn, state);

    assert.strictEqual(state.classifications.length, 2);
  });

  it('proposals in a multi-match carry distinct rule metadata', async () => {
    const classifier = new RulesClassifier([gen1FeatRule, anyFeatRule]);
    const state = buildState({ _type: 'feat', level: 1 });
    const next = makeNext();

    await classifier.execute(next.fn, state);

    const classNames = state.classifications.map((p) => p.className);
    assert.ok(classNames.includes('gen1-feat'), 'should include gen1-feat');
    assert.ok(classNames.includes('feat'),      'should include feat');

    const priorities = state.classifications.map((p) => p.priority);
    assert.ok(priorities.includes(20), 'should include priority 20');
    assert.ok(priorities.includes(10), 'should include priority 10');
  });

  it('calls next() after multi-match', async () => {
    const classifier = new RulesClassifier([gen1FeatRule, anyFeatRule]);
    const state = buildState({ _type: 'feat', level: 1 });
    const next = makeNext();

    await classifier.execute(next.fn, state);

    assert.strictEqual(next.called, true);
  });
});

describe('RulesClassifier — additive accumulation', () => {
  it('appends to pre-existing classifications rather than replacing them', async () => {
    const existing: ClassificationProposalInterface = {
      source:     'classify:structural',
      className:  'feat',
      priority:   10,
      confidence: 1,
      reasons:    ['_type=feat'],
    };

    const classifier = new RulesClassifier([gen1FeatRule]);
    const state = buildState({ _type: 'feat', level: 1 }, [existing]);
    const next = makeNext();

    await classifier.execute(next.fn, state);

    assert.strictEqual(state.classifications.length, 2);
    assert.strictEqual(state.classifications[0], existing);
    assert.strictEqual(state.classifications[1]?.className, 'gen1-feat');
  });
});

// ── Plugin self-registration (silo migration, task #14) ──────────────────────

/**
 * Builds a stub PipelineContextInterface populated with just the slots the
 * `classify:rules` `onRunStart` hook reads (`config`, `ajv`, `target`).
 */
function buildCtxStub(rulesConfig: unknown): PipelineContextInterface {
  const ajv = new Ajv({ allErrors: true, strict: true, useDefaults: false });
  const ctx = {
    target:  'test-target',
    outDir:  './graphs',
    config:  rulesConfig === undefined ? {} : { rules: rulesConfig },
    ajv,
  } as unknown as PipelineContextInterface;
  return ctx;
}

/** Builds a state for the per-record task with the given context attached. */
function buildStateWithCtx(
  ctx:   PipelineContextInterface,
  input: Readonly<Record<string, unknown>> = {},
): PipelineStateInterface {
  return {
    targetId:        'test-target',
    source:          { target: 'test-target', path: 'fixture.json' },
    input,
    classification:  null,
    classifications: [],
    output:          null,
    context:         ctx,
  };
}

/** Looks up the global `classify:rules` `onRunStart` hook. */
function findClassifyRulesHook(): (ctx: PipelineContextInterface) => void | Promise<void> {
  const hook = TaskRegistry.onRunStartHooks().find(([n]) => n === 'classify:rules');
  assert.ok(hook, '`classify:rules` onRunStart hook should be registered at module load');
  return hook[1];
}

describe('classify:rules — self-registered plugin manifest', () => {
  it('registers an onRunStart hook on the global TaskRegistry', () => {
    const names = TaskRegistry.onRunStartHooks().map(([n]) => n);
    assert.ok(names.includes('classify:rules'), 'expected classify:rules hook to be registered');
  });

  it('registers the per-record task on the global TaskRegistry', () => {
    assert.equal(TaskRegistry.has('classify:rules'), true);
  });

  it('manifest carries proposesClass: true', () => {
    const manifest = TaskRegistry.manifests().find(m => m.name === 'classify:rules');
    assert.ok(manifest, 'expected classify:rules manifest to be present');
    assert.equal(manifest.proposesClass, true);
  });
});

describe('classify:rules — onRunStart hook', () => {
  it('no-ops when ctx.config.rules is absent (hook safe to import unconditionally)', async () => {
    const hook = findClassifyRulesHook();
    const ctx  = buildCtxStub(undefined);

    await hook(ctx);

    // Hook should not throw and the per-record task should now no-op cleanly.
    const task = TaskRegistry.get('classify:rules');
    const state = buildStateWithCtx(ctx, { _type: 'feat', level: 1 });
    const next  = makeNext();
    await task(next.fn, state);
    assert.strictEqual(state.classifications.length, 0);
    assert.strictEqual(next.called, true);
  });

  it('compiles rules at onRunStart and the per-record task emits proposals from the cached form', async () => {
    const hook = findClassifyRulesHook();
    const ctx  = buildCtxStub([
      {
        className: 'feat',
        priority:  10,
        predicate: { path: '/_type', equals: 'feat' },
        reasons:   ['_type=feat'],
      },
      {
        className: 'gen1-feat',
        priority:  20,
        predicate: { all: [
          { path: '/_type', equals: 'feat' },
          { path: '/level', type: 'number' },
        ] },
        reasons:   ['_type=feat', 'level present'],
      },
    ]);

    await hook(ctx);

    const task  = TaskRegistry.get('classify:rules');
    const state = buildStateWithCtx(ctx, { _type: 'feat', level: 1 });
    const next  = makeNext();

    await task(next.fn, state);

    assert.strictEqual(state.classifications.length, 2);
    assert.strictEqual(next.called, true);

    const classNames = state.classifications.map(p => p.className).sort();
    assert.deepStrictEqual(classNames, ['feat', 'gen1-feat']);

    // All proposals carry source classify:rules.
    for (const p of state.classifications) {
      assert.strictEqual(p.source, 'classify:rules');
    }
  });

  it('throws OutputConfigError when ctx.config.rules fails AJV validation', () => {
    const hook = findClassifyRulesHook();
    const ctx  = buildCtxStub([
      // missing `predicate` field
      { className: 'feat', priority: 10, reasons: [] },
    ]);

    assert.throws(
      () => hook(ctx),
      (err: unknown) => {
        assert.ok(err instanceof OutputConfigError, `Expected OutputConfigError, got ${String(err)}`);
        assert.match(err.message, /classify:rules/);
        return true;
      },
    );
  });

  it('throws when ctx.config.rules is an empty array (minItems: 1)', () => {
    const hook = findClassifyRulesHook();
    const ctx  = buildCtxStub([]);

    assert.throws(
      () => hook(ctx),
      (err: unknown) => {
        assert.ok(err instanceof OutputConfigError, `Expected OutputConfigError, got ${String(err)}`);
        return true;
      },
    );
  });

  it('Predicate.compile errors propagate as OutputConfigError (e.g. unanchored regex)', () => {
    const hook = findClassifyRulesHook();
    const ctx  = buildCtxStub([
      {
        className: 'feat',
        priority:  10,
        predicate: { path: '/name', regex: 'foo' },  // not anchored — Predicate.compile rejects
        reasons:   [],
      },
    ]);

    assert.throws(
      () => hook(ctx),
      (err: unknown) => {
        assert.ok(err instanceof OutputConfigError, `Expected OutputConfigError, got ${String(err)}`);
        return true;
      },
    );
  });
});

describe('classify:rules — per-record task isolation across contexts', () => {
  it('proposals from one ctx do not leak into another (WeakMap-keyed cache)', async () => {
    const hook = findClassifyRulesHook();

    const ctxA = buildCtxStub([
      {
        className: 'feat',
        priority:  10,
        predicate: { path: '/_type', equals: 'feat' },
        reasons:   ['_type=feat'],
      },
    ]);
    const ctxB = buildCtxStub([
      {
        className: 'monster',
        priority:  10,
        predicate: { path: '/_type', equals: 'monster' },
        reasons:   ['_type=monster'],
      },
    ]);

    await hook(ctxA);
    await hook(ctxB);

    const task = TaskRegistry.get('classify:rules');

    const stateA = buildStateWithCtx(ctxA, { _type: 'feat' });
    const nextA  = makeNext();
    await task(nextA.fn, stateA);
    assert.strictEqual(stateA.classifications.length, 1);
    assert.strictEqual(stateA.classifications[0]?.className, 'feat');

    const stateB = buildStateWithCtx(ctxB, { _type: 'feat' });
    const nextB  = makeNext();
    await task(nextB.fn, stateB);
    // ctxB's cache only has the monster rule; a feat record matches nothing.
    assert.strictEqual(stateB.classifications.length, 0);
  });
});
