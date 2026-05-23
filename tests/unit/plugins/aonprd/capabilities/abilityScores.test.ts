// Unit tests for ability-scores capability.
// Tests parseAbilityScores() with representative patterns.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseAbilityScores } from '../../../../../plugins/aonprd/capabilities/abilityScores.js';
import type { CommonExtraction } from '../../../../../plugins/aonprd/common.js';

const mockCommon: CommonExtraction = {
  url: 'https://2e.aonprd.com/Monsters.aspx?ID=1',
  page_type: 'monster',
  title: { name: 'Test Monster', level_label: 'Creature 1', level: 1, level_kind: 'Creature', tiered: false, action_cost: null, pfs: null, legacy: false, alt_edition_url: null },
  traits: { traits: [], rarity: 'common', size: null, alignment: null, trait_ids: {} },
  source: { book: null, page: null, source_id: null, raw: '' },
  sources: [],
  field_map: {},
  body_text: '',
  body_html: '',
  sections: [],
  links: [],
  fields: [],
};

describe('parseAbilityScores — basic parsing', () => {
  it('parses ability scores from field values', () => {
    const c: CommonExtraction = {
      ...mockCommon,
      fields: [
        { label: 'Str', value_text: '+3', value_html: '+3', order: 0 },
        { label: 'Dex', value_text: '+2', value_html: '+2', order: 1 },
        { label: 'Con', value_text: '+4', value_html: '+4', order: 2 },
        { label: 'Int', value_text: '-1', value_html: '-1', order: 3 },
        { label: 'Wis', value_text: '+1', value_html: '+1', order: 4 },
        { label: 'Cha', value_text: '+0', value_html: '+0', order: 5 },
      ],
      field_map: {
        'str': '+3',
        'dex': '+2',
        'con': '+4',
        'int': '-1',
        'wis': '+1',
        'cha': '+0',
      },
    };
    const result = parseAbilityScores(c);
    assert.deepEqual(result, {
      str: 3, dex: 2, con: 4, int: -1, wis: 1, cha: 0,
    });
  });

  it('returns nulls for missing ability scores', () => {
    const c: CommonExtraction = {
      ...mockCommon,
      fields: [
        { label: 'Str', value_text: '+2', value_html: '+2', order: 0 },
      ],
      field_map: { 'str': '+2' },
    };
    const result = parseAbilityScores(c);
    assert.equal(result.str, 2);
    assert.equal(result.dex, null);
    assert.equal(result.con, null);
    assert.equal(result.int, null);
    assert.equal(result.wis, null);
    assert.equal(result.cha, null);
  });

  it('parses HTML with bold tags in field values', () => {
    const c: CommonExtraction = {
      ...mockCommon,
      fields: [
        { label: 'Str', value_text: '+3', value_html: '<b>Str</b> +3', order: 0 },
        { label: 'Dex', value_text: '+2', value_html: '<b>Dex</b> +2', order: 1 },
        { label: 'Con', value_text: '+4', value_html: '<b>Con</b> +4', order: 2 },
        { label: 'Int', value_text: '-1', value_html: '<b>Int</b> -1', order: 3 },
        { label: 'Wis', value_text: '+1', value_html: '<b>Wis</b> +1', order: 4 },
        { label: 'Cha', value_text: '+0', value_html: '<b>Cha</b> +0', order: 5 },
      ],
      field_map: {
        'str': '+3',
        'dex': '+2',
        'con': '+4',
        'int': '-1',
        'wis': '+1',
        'cha': '+0',
      },
    };
    const result = parseAbilityScores(c);
    assert.deepEqual(result, {
      str: 3, dex: 2, con: 4, int: -1, wis: 1, cha: 0,
    });
  });
});

describe('parseAbilityScores — edge cases', () => {
  it('handles all zero abilities', () => {
    const c: CommonExtraction = {
      ...mockCommon,
      fields: [
        { label: 'Str', value_text: '+0', value_html: '+0', order: 0 },
        { label: 'Dex', value_text: '+0', value_html: '+0', order: 1 },
        { label: 'Con', value_text: '+0', value_html: '+0', order: 2 },
        { label: 'Int', value_text: '+0', value_html: '+0', order: 3 },
        { label: 'Wis', value_text: '+0', value_html: '+0', order: 4 },
        { label: 'Cha', value_text: '+0', value_html: '+0', order: 5 },
      ],
      field_map: {
        'str': '+0', 'dex': '+0', 'con': '+0', 'int': '+0', 'wis': '+0', 'cha': '+0',
      },
    };
    const result = parseAbilityScores(c);
    assert.deepEqual(result, {
      str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0,
    });
  });

  it('handles very large positive modifiers', () => {
    const c: CommonExtraction = {
      ...mockCommon,
      fields: [
        { label: 'Str', value_text: '+20', value_html: '+20', order: 0 },
      ],
      field_map: { 'str': '+20' },
    };
    const result = parseAbilityScores(c);
    assert.equal(result.str, 20);
  });

  it('handles very large negative modifiers', () => {
    const c: CommonExtraction = {
      ...mockCommon,
      fields: [
        { label: 'Int', value_text: '-12', value_html: '-12', order: 0 },
      ],
      field_map: { 'int': '-12' },
    };
    const result = parseAbilityScores(c);
    assert.equal(result.int, -12);
  });

  it('handles non-numeric values gracefully', () => {
    const c: CommonExtraction = {
      ...mockCommon,
      fields: [
        { label: 'Str', value_text: 'not a number', value_html: 'not a number', order: 0 },
      ],
      field_map: { 'str': 'not a number' },
    };
    const result = parseAbilityScores(c);
    assert.equal(result.str, null);
  });

  it('handles empty fields array', () => {
    const c: CommonExtraction = {
      ...mockCommon,
      fields: [],
      field_map: {},
    };
    const result = parseAbilityScores(c);
    assert.deepEqual(result, {
      str: null, dex: null, con: null, int: null, wis: null, cha: null,
    });
  });
});
