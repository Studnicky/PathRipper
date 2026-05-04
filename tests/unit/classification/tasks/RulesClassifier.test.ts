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

import { RulesClassifier } from '../../../../src/classification/tasks/RulesClassifier.js';
import type { RuleEntryInterface } from '../../../../src/classification/tasks/RulesClassifier.js';
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

/**
 * A compound rule: matches records where `_type` is `'pokemon'` AND `ndex`
 * is in the range [1, 151].
 */
const gen1PokemonRule: RuleEntryInterface = {
  className: 'gen1-pokemon',
  priority:  20,
  predicate: Predicate.compile({
    all: [
      { path: '/_type', equals: 'pokemon' },
      { path: '/ndex', range: { gte: 1, lte: 151 } },
    ],
  }),
  reasons: ['_type=pokemon', 'ndex in [1,151]'],
};

/** Matches any record where `_type` is `'pokemon'`. */
const anyPokemonRule: RuleEntryInterface = {
  className: 'pokemon',
  priority:  10,
  predicate: Predicate.compile({ path: '/_type', equals: 'pokemon' }),
  reasons:   ['_type=pokemon'],
};

/** Matches records where `_type` is `'trainer'`. */
const trainerRule: RuleEntryInterface = {
  className: 'trainer',
  priority:  10,
  predicate: Predicate.compile({ path: '/_type', equals: 'trainer' }),
  reasons:   ['_type=trainer'],
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RulesClassifier — constructor', () => {
  it('constructs successfully with at least one rule', () => {
    const classifier = new RulesClassifier([anyPokemonRule]);
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
    const classifier = new RulesClassifier([anyPokemonRule]);
    assert.strictEqual(typeof classifier.execute, 'function');
  });

  it('frozen-rules invariant: mutating the input array after construction has no effect', async () => {
    const mutableRules: RuleEntryInterface[] = [anyPokemonRule];
    const classifier = new RulesClassifier(mutableRules);

    // Push a trainer rule into the original array after construction.
    mutableRules.push(trainerRule);

    // A trainer record should NOT match anyPokemonRule; if the internal array
    // referenced the mutable original it would now also evaluate trainerRule.
    const state = buildState({ _type: 'trainer' });
    const next = makeNext();

    await classifier.execute(next.fn, state);

    // Only anyPokemonRule is in the frozen internal copy; it does not match
    // { _type: 'trainer' }, so zero proposals should be emitted.
    assert.strictEqual(state.classifications.length, 0);
  });
});

describe('RulesClassifier — no match', () => {
  it('emits no proposals when no rule matches', async () => {
    const classifier = new RulesClassifier([anyPokemonRule, trainerRule]);
    const state = buildState({ _type: 'item' });
    const next = makeNext();

    await classifier.execute(next.fn, state);

    assert.strictEqual(state.classifications.length, 0);
  });

  it('calls next() even when no rule matches', async () => {
    const classifier = new RulesClassifier([anyPokemonRule]);
    const state = buildState({ _type: 'item' });
    const next = makeNext();

    await classifier.execute(next.fn, state);

    assert.strictEqual(next.called, true);
  });
});

describe('RulesClassifier — single match', () => {
  it('emits one proposal when exactly one rule matches', async () => {
    const classifier = new RulesClassifier([anyPokemonRule, trainerRule]);
    const state = buildState({ _type: 'pokemon', ndex: 999 });
    const next = makeNext();

    await classifier.execute(next.fn, state);

    assert.strictEqual(state.classifications.length, 1);
  });

  it('emitted proposal carries source classify:rules', async () => {
    const classifier = new RulesClassifier([anyPokemonRule]);
    const state = buildState({ _type: 'pokemon', ndex: 25 });
    const next = makeNext();

    await classifier.execute(next.fn, state);

    assert.strictEqual(state.classifications[0]?.source, 'classify:rules');
  });

  it('emitted proposal carries correct className, priority, confidence, and reasons', async () => {
    const classifier = new RulesClassifier([gen1PokemonRule]);
    const state = buildState({ _type: 'pokemon', ndex: 25 });
    const next = makeNext();

    await classifier.execute(next.fn, state);

    const proposal = state.classifications[0];
    assert.ok(proposal !== undefined);
    assert.strictEqual(proposal.className,  'gen1-pokemon');
    assert.strictEqual(proposal.priority,   20);
    assert.strictEqual(proposal.confidence, 1);
    assert.deepStrictEqual(proposal.reasons, ['_type=pokemon', 'ndex in [1,151]']);
  });

  it('calls next() after emitting a proposal', async () => {
    const classifier = new RulesClassifier([anyPokemonRule]);
    const state = buildState({ _type: 'pokemon' });
    const next = makeNext();

    await classifier.execute(next.fn, state);

    assert.strictEqual(next.called, true);
  });
});

describe('RulesClassifier — multi match', () => {
  it('emits one proposal per matching rule when both rules match the same record', async () => {
    // gen1PokemonRule (ndex 1-151) AND anyPokemonRule (_type=pokemon) both match.
    const classifier = new RulesClassifier([gen1PokemonRule, anyPokemonRule, trainerRule]);
    const state = buildState({ _type: 'pokemon', ndex: 1 });
    const next = makeNext();

    await classifier.execute(next.fn, state);

    assert.strictEqual(state.classifications.length, 2);
  });

  it('proposals in a multi-match carry distinct rule metadata', async () => {
    const classifier = new RulesClassifier([gen1PokemonRule, anyPokemonRule]);
    const state = buildState({ _type: 'pokemon', ndex: 25 });
    const next = makeNext();

    await classifier.execute(next.fn, state);

    const classNames = state.classifications.map((p) => p.className);
    assert.ok(classNames.includes('gen1-pokemon'), 'should include gen1-pokemon');
    assert.ok(classNames.includes('pokemon'),      'should include pokemon');

    const priorities = state.classifications.map((p) => p.priority);
    assert.ok(priorities.includes(20), 'should include priority 20');
    assert.ok(priorities.includes(10), 'should include priority 10');
  });

  it('calls next() after multi-match', async () => {
    const classifier = new RulesClassifier([gen1PokemonRule, anyPokemonRule]);
    const state = buildState({ _type: 'pokemon', ndex: 1 });
    const next = makeNext();

    await classifier.execute(next.fn, state);

    assert.strictEqual(next.called, true);
  });
});

describe('RulesClassifier — additive accumulation', () => {
  it('appends to pre-existing classifications rather than replacing them', async () => {
    const existing: ClassificationProposalInterface = {
      source:     'classify:structural',
      className:  'pokemon',
      priority:   10,
      confidence: 1,
      reasons:    ['_type=pokemon'],
    };

    const classifier = new RulesClassifier([gen1PokemonRule]);
    const state = buildState({ _type: 'pokemon', ndex: 25 }, [existing]);
    const next = makeNext();

    await classifier.execute(next.fn, state);

    assert.strictEqual(state.classifications.length, 2);
    assert.strictEqual(state.classifications[0], existing);
    assert.strictEqual(state.classifications[1]?.className, 'gen1-pokemon');
  });
});
