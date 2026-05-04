/**
 * @fileoverview Unit tests for the {@link AjvClassifier} schema classification engine.
 *
 * @remarks
 * Tests the engine in isolation using two inline AJV schemas: one for objects
 * with a required `_type: 'pokemon'` property, and one for objects with a
 * required `_type: 'trainer'` property.
 *
 * Covers: no-match → empty array, single match → one proposal, both schemas
 * match → two proposals with priority preserved, invalid (non-object) record
 * → no match, and empty entries → throws OutputConfigError.
 *
 * @category Classification
 * @since 2.2.0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import AjvModule from 'ajv';
import addFormatsModule from 'ajv-formats';

import type { AjvCtorType, AddFormatsFnInterface } from '../../../src/types/AjvInterop.js';
import { AjvClassifier } from '../../../src/classification/AjvClassifier.js';
import type { AjvClassEntryInterface } from '../../../src/classification/AjvClassifier.js';
import { OutputConfigError } from '../../../src/errors/OutputConfigError.js';

// ── AJV setup (mirrors SquashageConfig.ts interop pattern) ────────────────────

const Ajv        = (AjvModule        as unknown as { default?: AjvCtorType }).default        ?? (AjvModule        as unknown as AjvCtorType);
const addFormats = (addFormatsModule as unknown as { default?: AddFormatsFnInterface }).default ?? (addFormatsModule as unknown as AddFormatsFnInterface);

const ajv = new Ajv({ strict: true, allErrors: false });
addFormats(ajv);

// ── Schemas ───────────────────────────────────────────────────────────────────

const pokemonSchema = {
  type: 'object',
  required: ['_type'],
  properties: { _type: { const: 'pokemon' } },
  additionalProperties: true,
} as const;

const trainerSchema = {
  type: 'object',
  required: ['_type'],
  properties: { _type: { const: 'trainer' } },
  additionalProperties: true,
} as const;

// ── Entries ───────────────────────────────────────────────────────────────────

const pokemonEntry: AjvClassEntryInterface = {
  className: 'pokemon',
  priority:  10,
  validate:  ajv.compile(pokemonSchema),
};

const trainerEntry: AjvClassEntryInterface = {
  className: 'trainer',
  priority:  5,
  validate:  ajv.compile(trainerSchema),
};

// ── empty entries ─────────────────────────────────────────────────────────────

describe('AjvClassifier — constructor', () => {
  it('throws OutputConfigError when entries is empty', () => {
    assert.throws(
      () => new AjvClassifier([]),
      (err: unknown) => {
        assert.ok(err instanceof OutputConfigError, `Expected OutputConfigError, got ${String(err)}`);
        assert.match(err.message, /at least one entry/i);
        return true;
      },
    );
  });
});

// ── no match ──────────────────────────────────────────────────────────────────

describe('AjvClassifier — no match', () => {
  it('returns empty array when no validator matches', () => {
    const engine = new AjvClassifier([pokemonEntry, trainerEntry]);
    const proposals = engine.classify({ _type: 'item', name: 'Potion' });
    assert.deepStrictEqual(proposals, []);
  });

  it('returns empty array for a non-object record', () => {
    const engine = new AjvClassifier([pokemonEntry, trainerEntry]);
    const proposals = engine.classify('a string, not an object');
    assert.deepStrictEqual(proposals, []);
  });

  it('returns empty array for null', () => {
    const engine = new AjvClassifier([pokemonEntry]);
    assert.deepStrictEqual(engine.classify(null), []);
  });
});

// ── single match ──────────────────────────────────────────────────────────────

describe('AjvClassifier — single match', () => {
  it('returns one proposal when only the pokemon schema matches', () => {
    const engine = new AjvClassifier([pokemonEntry, trainerEntry]);
    const proposals = engine.classify({ _type: 'pokemon', ndex: 1, name: 'Bulbasaur' });

    assert.strictEqual(proposals.length, 1);
    const [p] = proposals;
    assert.ok(p !== undefined);
    assert.strictEqual(p.source,     'classify:schema');
    assert.strictEqual(p.className,  'pokemon');
    assert.strictEqual(p.priority,   10);
    assert.strictEqual(p.confidence, 1);
    assert.deepStrictEqual(p.reasons, ['schema:pokemon matched']);
  });

  it('returns one proposal when only the trainer schema matches', () => {
    const engine = new AjvClassifier([pokemonEntry, trainerEntry]);
    const proposals = engine.classify({ _type: 'trainer', name: 'Ash' });

    assert.strictEqual(proposals.length, 1);
    const [p] = proposals;
    assert.ok(p !== undefined);
    assert.strictEqual(p.className, 'trainer');
    assert.strictEqual(p.priority,  5);
  });
});

// ── both schemas match ────────────────────────────────────────────────────────

describe('AjvClassifier — multiple matches', () => {
  // Build a permissive schema that matches any object so we can force two matches
  const anyObjectEntry: AjvClassEntryInterface = {
    className: 'any-object',
    priority:  0,
    validate:  ajv.compile({ type: 'object' }),
  };

  it('returns two proposals when both schemas match, preserving entry order', () => {
    const engine = new AjvClassifier([pokemonEntry, anyObjectEntry]);
    const proposals = engine.classify({ _type: 'pokemon', ndex: 25 });

    assert.strictEqual(proposals.length, 2);
    assert.strictEqual(proposals[0]?.className, 'pokemon');
    assert.strictEqual(proposals[0]?.priority,  10);
    assert.strictEqual(proposals[1]?.className, 'any-object');
    assert.strictEqual(proposals[1]?.priority,  0);
  });

  it('preserves priority values from entries without modification', () => {
    const engine = new AjvClassifier([pokemonEntry, anyObjectEntry]);
    const proposals = engine.classify({ _type: 'pokemon' });

    const priorities = proposals.map(p => p.priority);
    assert.deepStrictEqual(priorities, [10, 0]);
  });
});
