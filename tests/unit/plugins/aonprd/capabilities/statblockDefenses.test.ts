// Unit tests for statblock-defenses capability.
// Tests parseStatblockDefenses() with representative HTML patterns.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseStatblockDefenses } from '../../../../../plugins/aonprd/capabilities/statblockDefenses.js';
import type { CommonExtraction } from '../../../../../plugins/aonprd/common.js';

const mockCommon: CommonExtraction = {
  url: 'https://2e.aonprd.com/Monsters.aspx?ID=1',
  page_type: 'monster',
  title: { name: 'Test Monster', level_label: 'Creature 1', level: 1, level_kind: 'Creature', tiered: false, action_cost: null, pfs: null, legacy: false, alt_edition_url: null },
  traits: { traits: [], rarity: 'common', size: null, alignment: null, trait_ids: {} },
  source: { book: null, page: null, source_id: null, raw: '' },
  sources: [],
  fields: [],
  field_map: {},
  body_text: '',
  body_html: '',
  sections: [],
  links: [],
};

describe('parseStatblockDefenses — AC parsing', () => {
  it('parses simple AC value', () => {
    const html = '<b>AC</b> 18';
    const result = parseStatblockDefenses(html);
    assert.deepEqual(result.ac, { value: 18, conditional: null, saves_note: null });
  });

  it('parses AC with conditional', () => {
    const html = '<b>AC</b> 20 (25 while standing on earth)';
    const result = parseStatblockDefenses(html);
    assert.deepEqual(result.ac, { value: 20, conditional: '25 while standing on earth', saves_note: null });
  });

  it('parses negative AC', () => {
    const html = '<b>AC</b> -5';
    const result = parseStatblockDefenses(html);
    assert.deepEqual(result.ac, { value: -5, conditional: null, saves_note: null });
  });
});

describe('parseStatblockDefenses — saves parsing', () => {
  it('parses Fort/Ref/Will saves', () => {
    const html = '<b>Fort</b> +12; <b>Ref</b> +10; <b>Will</b> +8';
    const result = parseStatblockDefenses(html);
    assert.deepEqual(result.saves, { fort: 12, ref: 10, will: 8 });
  });

  it('handles negative save modifiers', () => {
    const html = '<b>Fort</b> -3; <b>Ref</b> +2; <b>Will</b> -1';
    const result = parseStatblockDefenses(html);
    assert.deepEqual(result.saves, { fort: -3, ref: 2, will: -1 });
  });

  it('returns nulls for missing saves', () => {
    const html = '<b>Fort</b> +10';
    const result = parseStatblockDefenses(html);
    assert.equal(result.saves.fort, 10);
    assert.equal(result.saves.ref, null);
    assert.equal(result.saves.will, null);
  });
});

describe('parseStatblockDefenses — HP parsing', () => {
  it('parses simple HP value', () => {
    const html = '<b>HP</b> 210';
    const result = parseStatblockDefenses(html);
    assert.deepEqual(result.hp, { value: 210, special: null });
  });

  it('parses HP with fast healing', () => {
    const html = '<b>HP</b> 16 (fast healing 2)';
    const result = parseStatblockDefenses(html);
    assert.deepEqual(result.hp, { value: 16, special: '(fast healing 2)' });
  });

  it('parses HP with regeneration', () => {
    const html = '<b>HP</b> 380, regeneration 20 (deactivated by holy)';
    const result = parseStatblockDefenses(html);
    assert.deepEqual(result.hp, { value: 380, special: 'regeneration 20 (deactivated by holy)' });
  });
});

describe('parseStatblockDefenses — hardness parsing', () => {
  it('parses hardness value', () => {
    const html = '<b>Hardness</b> 12';
    const result = parseStatblockDefenses(html);
    assert.equal(result.hardness, 12);
  });

  it('returns null for missing hardness', () => {
    const html = '';
    const result = parseStatblockDefenses(html);
    assert.equal(result.hardness, null);
  });
});

describe('parseStatblockDefenses — immunities parsing', () => {
  it('parses comma-separated immunities', () => {
    const html = '<b>Immunities</b> disease, poison, mental';
    const result = parseStatblockDefenses(html);
    assert.deepEqual(result.immunities, ['disease', 'poison', 'mental']);
  });

  it('returns empty array for missing immunities', () => {
    const html = '';
    const result = parseStatblockDefenses(html);
    assert.deepEqual(result.immunities, []);
  });
});

describe('parseStatblockDefenses — weaknesses parsing', () => {
  it('parses weaknesses with values', () => {
    const html = '<b>Weaknesses</b> fire 10, cold 5';
    const result = parseStatblockDefenses(html);
    assert.deepEqual(result.weaknesses, [
      { type: 'fire', value: 10 },
      { type: 'cold', value: 5 },
    ]);
  });

  it('returns empty array for missing weaknesses', () => {
    const html = '';
    const result = parseStatblockDefenses(html);
    assert.deepEqual(result.weaknesses, []);
  });
});

describe('parseStatblockDefenses — resistances parsing', () => {
  it('parses resistances with values', () => {
    const html = '<b>Resistances</b> fire 15, cold 10';
    const result = parseStatblockDefenses(html);
    assert.deepEqual(result.resistances, [
      { type: 'fire', value: 15, exceptions: null },
      { type: 'cold', value: 10, exceptions: null },
    ]);
  });

  it('parses resistances with exceptions', () => {
    const html = '<b>Resistances</b> fire 10 (except magical), cold 5 (except ice)';
    const result = parseStatblockDefenses(html);
    assert.deepEqual(result.resistances, [
      { type: 'fire', value: 10, exceptions: 'magical' },
      { type: 'cold', value: 5, exceptions: 'ice' },
    ]);
  });

  it('returns empty array for missing resistances', () => {
    const html = '';
    const result = parseStatblockDefenses(html);
    assert.deepEqual(result.resistances, []);
  });
});

describe('parseStatblockDefenses — complete statblock', () => {
  it('parses full defenses section', () => {
    const html = `
      <b>AC</b> 22<br/>
      <b>Fort</b> +16; <b>Ref</b> +14; <b>Will</b> +12<br/>
      <b>HP</b> 156<br/>
      <b>Hardness</b> 8<br/>
      <b>Immunities</b> disease, poison<br/>
      <b>Weaknesses</b> slashing 10<br/>
      <b>Resistances</b> fire 15
    `;
    const result = parseStatblockDefenses(html);
    assert.equal(result.ac.value, 22);
    assert.deepEqual(result.saves, { fort: 16, ref: 14, will: 12 });
    assert.deepEqual(result.hp, { value: 156, special: null });
    assert.equal(result.hardness, 8);
    assert.deepEqual(result.immunities, ['disease', 'poison']);
    assert.deepEqual(result.weaknesses, [{ type: 'slashing', value: 10 }]);
    assert.deepEqual(result.resistances, [{ type: 'fire', value: 15, exceptions: null }]);
  });
});
