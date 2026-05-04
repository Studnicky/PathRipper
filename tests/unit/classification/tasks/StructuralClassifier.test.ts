/**
 * @fileoverview Unit tests for {@link StructuralClassifier}.
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

import { StructuralClassifier } from '../../../../src/classification/tasks/StructuralClassifier.js';
import type { StructuralRuleInterface } from '../../../../src/classification/tasks/StructuralClassifier.js';
import { Predicate } from '../../../../src/classification/predicates/Predicate.js';
import { OutputConfigError } from '../../../../src/errors/OutputConfigError.js';
import type { PipelineStateInterface } from '../../../../src/types/PipelineState.js';
import type { ClassificationProposalInterface } from '../../../../src/types/PipelineState.js';

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

/** A simple compiled rule matching `{ _type: 'pokemon' }`. */
const pokemonRule: StructuralRuleInterface = {
  className: 'pokemon',
  priority:  10,
  predicate: Predicate.compile({ path: '/_type', equals: 'pokemon' }),
  reasons:   ['_type=pokemon'],
};

/** A compiled rule matching `{ _type: 'trainer' }`. */
const trainerRule: StructuralRuleInterface = {
  className: 'trainer',
  priority:  5,
  predicate: Predicate.compile({ path: '/_type', equals: 'trainer' }),
  reasons:   ['_type=trainer'],
};

/** A compiled rule matching any record that has a `ndex` field. */
const hasNdexRule: StructuralRuleInterface = {
  className: 'pokemon',
  priority:  8,
  predicate: Predicate.compile({ path: '/ndex', exists: true }),
  reasons:   ['ndex exists'],
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('StructuralClassifier — constructor', () => {
  it('constructs successfully with at least one rule', () => {
    const classifier = new StructuralClassifier([pokemonRule]);
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
    const classifier = new StructuralClassifier([pokemonRule]);
    assert.strictEqual(typeof classifier.execute, 'function');
  });

  it('frozen-rules invariant: mutating the input array after construction has no effect', async () => {
    const mutableRules: StructuralRuleInterface[] = [pokemonRule];
    const classifier = new StructuralClassifier(mutableRules);

    // Push a new rule into the original array after construction.
    mutableRules.push(trainerRule);

    // A trainer record should NOT match pokemonRule, but if the internal
    // rules array referenced the mutable original it would now also evaluate
    // trainerRule — giving us two proposals instead of zero.
    const state = buildState({ _type: 'trainer' });
    const next = makeNext();

    await classifier.execute(next.fn, state);

    // Only pokemonRule is in the frozen internal copy; it does not match
    // { _type: 'trainer' }, so zero proposals should be emitted.
    assert.strictEqual(state.classifications.length, 0);
  });
});

describe('StructuralClassifier — no match', () => {
  it('emits no proposals when no rule matches', async () => {
    const classifier = new StructuralClassifier([pokemonRule]);
    const state = buildState({ _type: 'item' });
    const next = makeNext();

    await classifier.execute(next.fn, state);

    assert.strictEqual(state.classifications.length, 0);
  });

  it('calls next() even when no rule matches', async () => {
    const classifier = new StructuralClassifier([pokemonRule]);
    const state = buildState({ _type: 'item' });
    const next = makeNext();

    await classifier.execute(next.fn, state);

    assert.strictEqual(next.called, true);
  });
});

describe('StructuralClassifier — single match', () => {
  it('emits one proposal when exactly one rule matches', async () => {
    const classifier = new StructuralClassifier([pokemonRule, trainerRule]);
    const state = buildState({ _type: 'pokemon' });
    const next = makeNext();

    await classifier.execute(next.fn, state);

    assert.strictEqual(state.classifications.length, 1);
  });

  it('emitted proposal carries correct source, className, priority, and confidence', async () => {
    const classifier = new StructuralClassifier([pokemonRule]);
    const state = buildState({ _type: 'pokemon' });
    const next = makeNext();

    await classifier.execute(next.fn, state);

    const proposal = state.classifications[0];
    assert.ok(proposal !== undefined);
    assert.strictEqual(proposal.source,     'classify:structural');
    assert.strictEqual(proposal.className,  'pokemon');
    assert.strictEqual(proposal.priority,   10);
    assert.strictEqual(proposal.confidence, 1);
    assert.deepStrictEqual(proposal.reasons, ['_type=pokemon']);
  });

  it('calls next() after emitting a proposal', async () => {
    const classifier = new StructuralClassifier([pokemonRule]);
    const state = buildState({ _type: 'pokemon' });
    const next = makeNext();

    await classifier.execute(next.fn, state);

    assert.strictEqual(next.called, true);
  });
});

describe('StructuralClassifier — multi match', () => {
  it('emits one proposal per matching rule when multiple rules match', async () => {
    // Both pokemonRule (_type=pokemon) and hasNdexRule (ndex exists) match.
    const classifier = new StructuralClassifier([pokemonRule, trainerRule, hasNdexRule]);
    const state = buildState({ _type: 'pokemon', ndex: 1 });
    const next = makeNext();

    await classifier.execute(next.fn, state);

    assert.strictEqual(state.classifications.length, 2);
  });

  it('each proposal in a multi-match carries the correct rule metadata', async () => {
    const classifier = new StructuralClassifier([pokemonRule, hasNdexRule]);
    const state = buildState({ _type: 'pokemon', ndex: 25 });
    const next = makeNext();

    await classifier.execute(next.fn, state);

    const classNames = state.classifications.map((p) => p.className);
    assert.ok(classNames.includes('pokemon'));

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
      reasons:    ['source.target=bulbapedia'],
    };

    const classifier = new StructuralClassifier([pokemonRule]);
    const state = buildState({ _type: 'pokemon' }, [existing]);
    const next = makeNext();

    await classifier.execute(next.fn, state);

    assert.strictEqual(state.classifications.length, 2);
    assert.strictEqual(state.classifications[0], existing);
    assert.strictEqual(state.classifications[1]?.className, 'pokemon');
  });
});
