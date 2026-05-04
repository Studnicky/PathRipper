/**
 * @fileoverview Unit tests for {@link OntologyClassifier}.
 *
 * @remarks
 * Covers: constructor validation (empty classes throws), known className
 * passes without validation proposals, unknown className emits one
 * `__validation__` proposal with the correct reason format, multiple unknown
 * classNames each emit their own validation proposal, metadata-sentinel
 * proposals (`__source__`, `__validation__`, `unknown`) are ignored, and
 * `next()` is always called.
 *
 * @category Classification
 * @since 0.1.0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { OntologyClassifier } from '../../../../src/classification/tasks/OntologyClassifier.js';
import type { OntologyConfigInterface } from '../../../../src/classification/tasks/OntologyClassifier.js';
import { OutputConfigError } from '../../../../src/errors/OutputConfigError.js';
import type { PipelineStateInterface, ClassificationProposalInterface } from '../../../../src/types/PipelineState.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Builds a minimal PipelineStateInterface for testing. */
function buildState(
  classifications: ReadonlyArray<ClassificationProposalInterface> = [],
): PipelineStateInterface {
  return {
    targetId:        'test-target',
    source:          { target: 'test-target', path: 'fixture.json' },
    input:           {},
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

/** Minimal class map with two known classes. */
const knownClassMap: OntologyConfigInterface = {
  classes: {
    pokemon: 'https://pokemontology.dev/class/Pokemon',
    trainer: 'https://pokemontology.dev/class/Trainer',
  },
};

/** Builds a concrete proposal for testing. */
function makeProposal(
  className: string,
  source:    string = 'classify:rules',
): ClassificationProposalInterface {
  return {
    source,
    className,
    priority:   10,
    confidence: 1,
    reasons:    [`${className} matched`],
  };
}

// ── Constructor tests ─────────────────────────────────────────────────────────

describe('OntologyClassifier — constructor', () => {
  it('constructs successfully with at least one class entry', () => {
    const classifier = new OntologyClassifier(knownClassMap);
    assert.ok(classifier instanceof OntologyClassifier);
  });

  it('exposes a bound execute function', () => {
    const classifier = new OntologyClassifier(knownClassMap);
    assert.strictEqual(typeof classifier.execute, 'function');
  });

  it('throws OutputConfigError when classes map is empty', () => {
    assert.throws(
      () => new OntologyClassifier({ classes: {} }),
      (err: unknown) => {
        assert.ok(err instanceof OutputConfigError, `Expected OutputConfigError, got ${String(err)}`);
        assert.match(err.message, /at least one entry/);
        return true;
      },
    );
  });
});

// ── Known className ───────────────────────────────────────────────────────────

describe('OntologyClassifier — known className', () => {
  it('emits no validation proposals when the proposal className is in the class map', async () => {
    const classifier = new OntologyClassifier(knownClassMap);
    const state = buildState([makeProposal('pokemon')]);
    const next = makeNext();

    await classifier.execute(next.fn, state);

    // The existing proposal remains; no new validation proposals added.
    assert.strictEqual(state.classifications.length, 1);
    assert.strictEqual(state.classifications[0]?.className, 'pokemon');
  });

  it('calls next() when all proposals are known', async () => {
    const classifier = new OntologyClassifier(knownClassMap);
    const state = buildState([makeProposal('trainer')]);
    const next = makeNext();

    await classifier.execute(next.fn, state);

    assert.strictEqual(next.called, true);
  });

  it('handles multiple known proposals without emitting validation proposals', async () => {
    const classifier = new OntologyClassifier(knownClassMap);
    const state = buildState([
      makeProposal('pokemon', 'classify:rules'),
      makeProposal('trainer', 'classify:structural'),
    ]);
    const next = makeNext();

    await classifier.execute(next.fn, state);

    assert.strictEqual(state.classifications.length, 2);
    assert.ok(
      state.classifications.every((p) => p.className !== '__validation__'),
      'No __validation__ proposals should be emitted',
    );
  });
});

// ── Unknown className ─────────────────────────────────────────────────────────

describe('OntologyClassifier — unknown className', () => {
  it('emits one __validation__ proposal when the proposal className is not in the map', async () => {
    const classifier = new OntologyClassifier(knownClassMap);
    const state = buildState([makeProposal('legendary-pokemon')]);
    const next = makeNext();

    await classifier.execute(next.fn, state);

    const validationProposals = state.classifications.filter(
      (p) => p.className === '__validation__',
    );
    assert.strictEqual(validationProposals.length, 1);
  });

  it('validation proposal has source classify:ontology', async () => {
    const classifier = new OntologyClassifier(knownClassMap);
    const state = buildState([makeProposal('item')]);
    const next = makeNext();

    await classifier.execute(next.fn, state);

    const validationProposal = state.classifications.find(
      (p) => p.className === '__validation__',
    );
    assert.ok(validationProposal !== undefined);
    assert.strictEqual(validationProposal.source, 'classify:ontology');
  });

  it('validation proposal has priority 0, confidence 1', async () => {
    const classifier = new OntologyClassifier(knownClassMap);
    const state = buildState([makeProposal('item')]);
    const next = makeNext();

    await classifier.execute(next.fn, state);

    const validationProposal = state.classifications.find(
      (p) => p.className === '__validation__',
    );
    assert.ok(validationProposal !== undefined);
    assert.strictEqual(validationProposal.priority,   0);
    assert.strictEqual(validationProposal.confidence, 1);
  });

  it('validation proposal reason includes the unknown className and originating source', async () => {
    const classifier = new OntologyClassifier(knownClassMap);
    const state = buildState([makeProposal('legendary-pokemon', 'classify:rules')]);
    const next = makeNext();

    await classifier.execute(next.fn, state);

    const validationProposal = state.classifications.find(
      (p) => p.className === '__validation__',
    );
    assert.ok(validationProposal !== undefined);
    assert.strictEqual(validationProposal.reasons.length, 1);
    assert.strictEqual(
      validationProposal.reasons[0],
      'ontology-unknown: legendary-pokemon (from classify:rules)',
    );
  });

  it('calls next() when unknown proposals are flagged', async () => {
    const classifier = new OntologyClassifier(knownClassMap);
    const state = buildState([makeProposal('item')]);
    const next = makeNext();

    await classifier.execute(next.fn, state);

    assert.strictEqual(next.called, true);
  });
});

// ── Multiple unknown classNames ───────────────────────────────────────────────

describe('OntologyClassifier — multiple unknown classNames', () => {
  it('emits one __validation__ proposal per unknown className', async () => {
    const classifier = new OntologyClassifier(knownClassMap);
    const state = buildState([
      makeProposal('item',    'classify:rules'),
      makeProposal('ability', 'classify:structural'),
    ]);
    const next = makeNext();

    await classifier.execute(next.fn, state);

    const validationProposals = state.classifications.filter(
      (p) => p.className === '__validation__',
    );
    assert.strictEqual(validationProposals.length, 2);
  });

  it('each validation proposal carries the originating source in its reason', async () => {
    const classifier = new OntologyClassifier(knownClassMap);
    const state = buildState([
      makeProposal('item',    'classify:rules'),
      makeProposal('ability', 'classify:structural'),
    ]);
    const next = makeNext();

    await classifier.execute(next.fn, state);

    const validationProposals = state.classifications.filter(
      (p) => p.className === '__validation__',
    );
    const reasons = validationProposals.map((p) => p.reasons[0]);
    assert.ok(
      reasons.some((r) => r?.includes('item') && r.includes('classify:rules')),
      'should flag item from classify:rules',
    );
    assert.ok(
      reasons.some((r) => r?.includes('ability') && r.includes('classify:structural')),
      'should flag ability from classify:structural',
    );
  });

  it('preserves known proposals alongside validation proposals', async () => {
    const classifier = new OntologyClassifier(knownClassMap);
    const state = buildState([
      makeProposal('pokemon',  'classify:rules'),
      makeProposal('item',     'classify:structural'),
    ]);
    const next = makeNext();

    await classifier.execute(next.fn, state);

    // 2 original + 1 validation
    assert.strictEqual(state.classifications.length, 3);
    assert.ok(
      state.classifications.some((p) => p.className === 'pokemon'),
      'known proposal preserved',
    );
    assert.ok(
      state.classifications.some((p) => p.className === '__validation__'),
      'validation proposal added',
    );
  });
});

// ── Metadata sentinels ────────────────────────────────────────────────────────

describe('OntologyClassifier — metadata sentinels ignored', () => {
  it('ignores __source__ sentinel proposals', async () => {
    const classifier = new OntologyClassifier(knownClassMap);
    const state = buildState([makeProposal('__source__', 'classify:source')]);
    const next = makeNext();

    await classifier.execute(next.fn, state);

    // No validation proposals emitted for the sentinel.
    assert.strictEqual(
      state.classifications.filter((p) => p.className === '__validation__').length,
      0,
    );
  });

  it('ignores __validation__ sentinel proposals', async () => {
    const classifier = new OntologyClassifier(knownClassMap);
    const state = buildState([makeProposal('__validation__', 'classify:ontology')]);
    const next = makeNext();

    await classifier.execute(next.fn, state);

    // Still only one proposal — no new validation added for the sentinel.
    assert.strictEqual(state.classifications.length, 1);
  });

  it('ignores unknown sentinel proposals', async () => {
    const classifier = new OntologyClassifier(knownClassMap);
    const state = buildState([makeProposal('unknown', 'classify:rules')]);
    const next = makeNext();

    await classifier.execute(next.fn, state);

    assert.strictEqual(
      state.classifications.filter((p) => p.className === '__validation__').length,
      0,
    );
  });

  it('emits no proposals and calls next() on empty classifications', async () => {
    const classifier = new OntologyClassifier(knownClassMap);
    const state = buildState([]);
    const next = makeNext();

    await classifier.execute(next.fn, state);

    assert.strictEqual(state.classifications.length, 0);
    assert.strictEqual(next.called, true);
  });
});
