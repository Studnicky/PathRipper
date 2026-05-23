import { describe, it } from 'node:test';
import * as assert from 'node:assert';

import { parseSavingThrow } from '../../../../../plugins/aonprd/capabilities/savingThrow.js';

describe('parseSavingThrow', () => {
  it('parses DC + save name', () => {
    const result = parseSavingThrow('DC 28 Will');
    assert.deepStrictEqual(result, { dc: 28, save: 'Will', basic: false });
  });

  it('parses basic + DC + save name', () => {
    const result = parseSavingThrow('basic DC 22 Fortitude');
    assert.deepStrictEqual(result, { dc: 22, save: 'Fortitude', basic: true });
  });

  it('parses save name only', () => {
    const result = parseSavingThrow('Reflex');
    assert.deepStrictEqual(result, { dc: null, save: 'Reflex', basic: false });
  });

  it('parses basic + save name only', () => {
    const result = parseSavingThrow('basic Will');
    assert.deepStrictEqual(result, { dc: null, save: 'Will', basic: true });
  });

  it('parses DC only', () => {
    const result = parseSavingThrow('DC 25');
    assert.deepStrictEqual(result, { dc: 25, save: null, basic: false });
  });

  it('case-insensitive basic prefix', () => {
    const result = parseSavingThrow('BASIC DC 30 Fortitude');
    assert.deepStrictEqual(result, { dc: 30, save: 'Fortitude', basic: true });
  });

  it('returns null for null input', () => {
    const result = parseSavingThrow(null);
    assert.strictEqual(result, null);
  });

  it('returns null for empty string', () => {
    const result = parseSavingThrow('');
    assert.strictEqual(result, null);
  });

  it('returns null for whitespace-only string', () => {
    const result = parseSavingThrow('   ');
    assert.strictEqual(result, null);
  });

  it('handles malformed DC gracefully', () => {
    const result = parseSavingThrow('DC abc Will');
    // DC parse fails (non-numeric), so the entire remainder is the save
    assert.deepStrictEqual(result, { dc: null, save: 'DC abc Will', basic: false });
  });

  it('preserves save name with mixed case', () => {
    const result = parseSavingThrow('DC 20 Fortitude');
    assert.deepStrictEqual(result, { dc: 20, save: 'Fortitude', basic: false });
  });
});
