/**
 * @fileoverview Unit tests for {@link StructuralClassifier} and the
 * `classify:structural` self-registering plugin.
 *
 * @remarks
 * Covers two surfaces in one file (per the v0.7.0 silo migration consolidation):
 *
 * 1. Legacy class form — constructor validation (empty rules throws),
 *    frozen-rules invariant, no-match case, single-match case, multi-match
 *    case (multiple proposals), `next()` always called, additive accumulation.
 *
 * 2. Plugin form — self-registration (task + lifecycle hook + manifest),
 *    `onRunStart` (config-absent no-op, valid-config compile, invalid-config
 *    fail-fast), per-record dispatch (no-match, single-match, multi-match),
 *    `next()` always called, additive accumulation, idempotent
 *    predicate-schema registration on `ctx.ajv`.
 *
 * @category Classification
 * @since 0.1.0
 */

import { before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import AjvModule       from 'ajv';
import addFormatsModule from 'ajv-formats';

// Side-effect import: the canonical module both defines the legacy class AND
// self-registers the per-record task and onRunStart hook on the global
// TaskRegistry.
import {
  StructuralClassifier,
  STRUCTURAL_CONFIG_KEY,
  STRUCTURAL_CONFIG_SCHEMA,
  STRUCTURAL_PLUGIN_NAME,
  __isCachePopulatedForTests,
  __resetForTests,
  onRunStart,
} from '../../../../src/classification/tasks/StructuralClassifier.js';
import type { StructuralRuleInterface } from '../../../../src/classification/tasks/StructuralClassifier.js';
import { Predicate } from '../../../../src/classification/predicates/Predicate.js';
import { OutputConfigError } from '../../../../src/errors/OutputConfigError.js';
import { TaskRegistry } from '../../../../src/registry/TaskRegistry.js';
import type {
  ClassificationProposalInterface,
  PipelineContextInterface,
  PipelineStateInterface,
} from '../../../../src/types/PipelineState.js';
import type { AjvCtorType, AddFormatsFnInterface } from '../../../../src/types/AjvInterop.js';

// AJV 8.x dual-CJS/ESM unwrap.
const Ajv        = (AjvModule        as unknown as { default?: AjvCtorType }).default        ?? (AjvModule        as unknown as AjvCtorType);
const addFormats = (addFormatsModule as unknown as { default?: AddFormatsFnInterface }).default ?? (addFormatsModule as unknown as AddFormatsFnInterface);

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Builds a fresh AJV instance configured the same way `context:ajv` does. */
function buildAjv(): InstanceType<AjvCtorType> {
  const ajv = new Ajv({ allErrors: true, strict: true, useDefaults: false });
  addFormats(ajv);
  return ajv;
}

/** Builds a minimal context stub with a fresh AJV and the provided config. */
function buildCtx(config: Record<string, unknown>): PipelineContextInterface {
  return {
    ajv:    buildAjv(),
    config,
  } as unknown as PipelineContextInterface;
}

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

/** A simple compiled rule matching `{ _type: 'feat' }`. */
const featRule: StructuralRuleInterface = {
  className: 'feat',
  priority:  10,
  predicate: Predicate.compile({ path: '/_type', equals: 'feat' }),
  reasons:   ['_type=feat'],
};

/** A compiled rule matching `{ _type: 'monster' }`. */
const monsterRule: StructuralRuleInterface = {
  className: 'monster',
  priority:  5,
  predicate: Predicate.compile({ path: '/_type', equals: 'monster' }),
  reasons:   ['_type=monster'],
};

/** A compiled rule matching any record that has a `level` field. */
const hasLevelRule: StructuralRuleInterface = {
  className: 'feat',
  priority:  8,
  predicate: Predicate.compile({ path: '/level', exists: true }),
  reasons:   ['level exists'],
};

// ── Legacy class tests ────────────────────────────────────────────────────────

describe('StructuralClassifier — constructor', () => {
  it('constructs successfully with at least one rule', () => {
    const classifier = new StructuralClassifier([featRule]);
    assert.ok(classifier instanceof StructuralClassifier);
  });

  it('throws OutputConfigError when rules array is empty', () => {
    assert.throws(
      () => new StructuralClassifier([]),
      (err: unknown) => {
        assert.ok(err instanceof OutputConfigError, `Expected OutputConfigError, got ${String(err)}`);
        assert.match(err.message, /at least one rule/);
        return true;
      },
    );
  });

  it('exposes a bound execute function', () => {
    const classifier = new StructuralClassifier([featRule]);
    assert.strictEqual(typeof classifier.execute, 'function');
  });

  it('frozen-rules invariant: mutating the input array after construction has no effect', async () => {
    const mutableRules: StructuralRuleInterface[] = [featRule];
    const classifier = new StructuralClassifier(mutableRules);

    // Push a new rule into the original array after construction.
    mutableRules.push(monsterRule);

    // A trainer record should NOT match featRule, but if the internal
    // rules array referenced the mutable original it would now also evaluate
    // monsterRule — giving us two proposals instead of zero.
    const state = buildState({ _type: 'monster' });
    const next = makeNext();

    await classifier.execute(next.fn, state);

    // Only featRule is in the frozen internal copy; it does not match
    // { _type: 'monster' }, so zero proposals should be emitted.
    assert.strictEqual(state.classifications.length, 0);
  });
});

describe('StructuralClassifier — no match', () => {
  it('emits no proposals when no rule matches', async () => {
    const classifier = new StructuralClassifier([featRule]);
    const state = buildState({ _type: 'item' });
    const next = makeNext();

    await classifier.execute(next.fn, state);

    assert.strictEqual(state.classifications.length, 0);
  });

  it('calls next() even when no rule matches', async () => {
    const classifier = new StructuralClassifier([featRule]);
    const state = buildState({ _type: 'item' });
    const next = makeNext();

    await classifier.execute(next.fn, state);

    assert.strictEqual(next.called, true);
  });
});

describe('StructuralClassifier — single match', () => {
  it('emits one proposal when exactly one rule matches', async () => {
    const classifier = new StructuralClassifier([featRule, monsterRule]);
    const state = buildState({ _type: 'feat' });
    const next = makeNext();

    await classifier.execute(next.fn, state);

    assert.strictEqual(state.classifications.length, 1);
  });

  it('emitted proposal carries correct source, className, priority, and confidence', async () => {
    const classifier = new StructuralClassifier([featRule]);
    const state = buildState({ _type: 'feat' });
    const next = makeNext();

    await classifier.execute(next.fn, state);

    const proposal = state.classifications[0];
    assert.ok(proposal !== undefined);
    assert.strictEqual(proposal.source,     'classify:structural');
    assert.strictEqual(proposal.className,  'feat');
    assert.strictEqual(proposal.priority,   10);
    assert.strictEqual(proposal.confidence, 1);
    assert.deepStrictEqual(proposal.reasons, ['_type=feat']);
  });

  it('calls next() after emitting a proposal', async () => {
    const classifier = new StructuralClassifier([featRule]);
    const state = buildState({ _type: 'feat' });
    const next = makeNext();

    await classifier.execute(next.fn, state);

    assert.strictEqual(next.called, true);
  });
});

describe('StructuralClassifier — multi match', () => {
  it('emits one proposal per matching rule when multiple rules match', async () => {
    // Both featRule (_type=feat) and hasLevelRule (level exists) match.
    const classifier = new StructuralClassifier([featRule, monsterRule, hasLevelRule]);
    const state = buildState({ _type: 'feat', level: 1 });
    const next = makeNext();

    await classifier.execute(next.fn, state);

    assert.strictEqual(state.classifications.length, 2);
  });

  it('each proposal in a multi-match carries the correct rule metadata', async () => {
    const classifier = new StructuralClassifier([featRule, hasLevelRule]);
    const state = buildState({ _type: 'feat', level: 1 });
    const next = makeNext();

    await classifier.execute(next.fn, state);

    const classNames = state.classifications.map((p) => p.className);
    assert.ok(classNames.includes('feat'));

    const priorities = state.classifications.map((p) => p.priority);
    assert.ok(priorities.includes(10));
    assert.ok(priorities.includes(8));
  });
});

describe('StructuralClassifier — additive accumulation', () => {
  it('appends to pre-existing classifications rather than replacing them', async () => {
    const existing: ClassificationProposalInterface = {
      source:     'classify:source',
      className:  '__source__',
      priority:   0,
      confidence: 1,
      reasons:    ['source.target=aonprd'],
    };

    const classifier = new StructuralClassifier([featRule]);
    const state = buildState({ _type: 'feat' }, [existing]);
    const next = makeNext();

    await classifier.execute(next.fn, state);

    assert.strictEqual(state.classifications.length, 2);
    assert.strictEqual(state.classifications[0], existing);
    assert.strictEqual(state.classifications[1]?.className, 'feat');
  });
});

// ── Plugin tests ──────────────────────────────────────────────────────────────

describe('classify:structural plugin — self-registration', () => {
  it('registers a per-record task under the plugin name', () => {
    assert.strictEqual(TaskRegistry.has(STRUCTURAL_PLUGIN_NAME), true);
  });

  it('registers an onRunStart lifecycle hook under the plugin name', () => {
    const names = TaskRegistry.onRunStartHooks().map(([n]) => n);
    assert.ok(names.includes(STRUCTURAL_PLUGIN_NAME));
  });

  it('declares proposesClass: true in the manifest', () => {
    const manifest = TaskRegistry.manifests().find((m) => m.name === STRUCTURAL_PLUGIN_NAME);
    assert.ok(manifest, 'expected manifest entry to exist for the plugin');
    assert.strictEqual(manifest.proposesClass, true);
  });

  it('exposes the config namespace key', () => {
    assert.strictEqual(STRUCTURAL_CONFIG_KEY, 'structural');
  });

  it('exposes the AJV schema fragment with a stable $id', () => {
    assert.strictEqual(
      STRUCTURAL_CONFIG_SCHEMA.$id,
      'https://squashage.dev/schemas/plugins/classify-structural.json',
    );
  });
});

describe('classify:structural plugin — onRunStart (config absent)', () => {
  beforeEach(() => { __resetForTests(); });

  it('no-ops when ctx.config.structural is undefined', () => {
    const ctx = buildCtx({});
    onRunStart(ctx);
    assert.strictEqual(__isCachePopulatedForTests(), false);
  });
});

describe('classify:structural plugin — onRunStart (valid config)', () => {
  beforeEach(() => { __resetForTests(); });

  it('compiles a single-rule config and populates the cache', () => {
    const ctx = buildCtx({
      structural: [
        { className: 'feat', priority: 10, predicate: { path: '/_type', equals: 'feat' }, reasons: ['_type=feat'] },
      ],
    });
    onRunStart(ctx);
    assert.strictEqual(__isCachePopulatedForTests(), true);
  });

  it('compiles a multi-rule config without throwing', () => {
    const ctx = buildCtx({
      structural: [
        { className: 'feat',    priority: 10, predicate: { path: '/_type', equals: 'feat' },    reasons: ['_type=feat'] },
        { className: 'monster', priority:  5, predicate: { path: '/_type', equals: 'monster' }, reasons: ['_type=monster'] },
      ],
    });
    onRunStart(ctx);
    assert.strictEqual(__isCachePopulatedForTests(), true);
  });

  it('registers the predicate schema on ctx.ajv exactly once', () => {
    const ctx = buildCtx({
      structural: [
        { className: 'feat', priority: 10, predicate: { path: '/_type', equals: 'feat' }, reasons: ['x'] },
      ],
    });
    assert.strictEqual(ctx.ajv.getSchema('https://squashage.dev/schemas/predicate.json'), undefined);
    onRunStart(ctx);
    assert.notStrictEqual(ctx.ajv.getSchema('https://squashage.dev/schemas/predicate.json'), undefined);
    // Second call must not throw (idempotent — schema already present).
    onRunStart(ctx);
  });
});

describe('classify:structural plugin — onRunStart (invalid config)', () => {
  beforeEach(() => { __resetForTests(); });

  it('throws OutputConfigError when structural is not an array', () => {
    const ctx = buildCtx({ structural: { className: 'feat' } });
    assert.throws(
      () => onRunStart(ctx),
      (err: unknown) => {
        assert.ok(err instanceof OutputConfigError, `expected OutputConfigError, got ${String(err)}`);
        assert.match(err.message, /classify:structural/);
        return true;
      },
    );
    assert.strictEqual(__isCachePopulatedForTests(), false);
  });

  it('throws OutputConfigError when a rule is missing a required field', () => {
    const ctx = buildCtx({
      structural: [{ className: 'feat', priority: 10, predicate: { path: '/_type', equals: 'feat' } }],
    });
    assert.throws(() => onRunStart(ctx), OutputConfigError);
  });

  it('throws OutputConfigError when a predicate is malformed', () => {
    const ctx = buildCtx({
      structural: [{ className: 'feat', priority: 10, predicate: { bogus: true }, reasons: [] }],
    });
    assert.throws(() => onRunStart(ctx), OutputConfigError);
  });

  it('throws OutputConfigError on empty rules array (minItems: 1)', () => {
    const ctx = buildCtx({ structural: [] });
    assert.throws(() => onRunStart(ctx), OutputConfigError);
  });
});

describe('classify:structural plugin — per-record dispatch', () => {
  before(() => {
    __resetForTests();
    const ctx = buildCtx({
      structural: [
        { className: 'feat',    priority: 10, predicate: { path: '/_type', equals: 'feat' },    reasons: ['_type=feat'] },
        { className: 'monster', priority:  5, predicate: { path: '/_type', equals: 'monster' }, reasons: ['_type=monster'] },
        { className: 'feat',    priority:  8, predicate: { path: '/level', exists: true },      reasons: ['level exists'] },
      ],
    });
    onRunStart(ctx);
  });

  it('emits no proposals when no rule matches', async () => {
    const task  = TaskRegistry.get(STRUCTURAL_PLUGIN_NAME);
    const state = buildState({ _type: 'item' });
    const next  = makeNext();
    await task(next.fn, state);
    assert.strictEqual(state.classifications.length, 0);
    assert.strictEqual(next.called, true);
  });

  it('emits one proposal when exactly one rule matches', async () => {
    const task  = TaskRegistry.get(STRUCTURAL_PLUGIN_NAME);
    const state = buildState({ _type: 'monster' });
    const next  = makeNext();
    await task(next.fn, state);
    assert.strictEqual(state.classifications.length, 1);
    const proposal = state.classifications[0];
    assert.ok(proposal !== undefined);
    assert.strictEqual(proposal.source,     STRUCTURAL_PLUGIN_NAME);
    assert.strictEqual(proposal.className,  'monster');
    assert.strictEqual(proposal.priority,   5);
    assert.strictEqual(proposal.confidence, 1);
    assert.deepStrictEqual(proposal.reasons, ['_type=monster']);
    assert.strictEqual(next.called, true);
  });

  it('emits one proposal per matching rule when multiple rules match', async () => {
    const task  = TaskRegistry.get(STRUCTURAL_PLUGIN_NAME);
    const state = buildState({ _type: 'feat', level: 1 });
    const next  = makeNext();
    await task(next.fn, state);
    assert.strictEqual(state.classifications.length, 2);
    const priorities = state.classifications.map((p) => p.priority).sort((a, b) => a - b);
    assert.deepStrictEqual(priorities, [8, 10]);
    assert.strictEqual(next.called, true);
  });

  it('appends to pre-existing classifications rather than replacing them', async () => {
    const existing: ClassificationProposalInterface = {
      source:     'classify:source',
      className:  '__source__',
      priority:   0,
      confidence: 1,
      reasons:    ['source.target=aonprd'],
    };
    const task  = TaskRegistry.get(STRUCTURAL_PLUGIN_NAME);
    const state = buildState({ _type: 'monster' }, [existing]);
    const next  = makeNext();
    await task(next.fn, state);
    assert.strictEqual(state.classifications.length, 2);
    assert.strictEqual(state.classifications[0], existing);
    assert.strictEqual(state.classifications[1]?.className, 'monster');
  });
});

describe('classify:structural plugin — per-record dispatch with empty cache', () => {
  beforeEach(() => { __resetForTests(); });

  it('no-ops and calls next when onRunStart never populated the cache', async () => {
    const task  = TaskRegistry.get(STRUCTURAL_PLUGIN_NAME);
    const state = buildState({ _type: 'feat' });
    const next  = makeNext();
    await task(next.fn, state);
    assert.strictEqual(state.classifications.length, 0);
    assert.strictEqual(next.called, true);
  });
});
