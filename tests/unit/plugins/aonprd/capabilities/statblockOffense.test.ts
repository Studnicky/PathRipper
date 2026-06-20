// Unit tests for statblock-offense capability.
// Tests parseStatblockOffense() with representative HTML patterns.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseStatblockOffense } from '../../../../../plugins/aonprd/capabilities/statblockOffense.js';
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

describe('parseStatblockOffense — speed parsing', () => {
  it('parses walk speed only', () => {
    const html = '<b>Speed</b> 40 feet';
    const result = parseStatblockOffense(html, mockCommon);
    assert.deepEqual(result.speed, {
      walk: 40, burrow: null, climb: null, fly: null, swim: null, special: null,
    });
  });

  it('parses multiple movement types', () => {
    const html = '<b>Speed</b> 30 feet, climb 30 feet, fly 60 feet';
    const result = parseStatblockOffense(html, mockCommon);
    assert.deepEqual(result.speed, {
      walk: 30, burrow: null, climb: 30, fly: 60, swim: null, special: null,
    });
  });

  it('parses special movement', () => {
    const html = '<b>Speed</b> 20 feet, burrow 20 feet, swim 30 feet';
    const result = parseStatblockOffense(html, mockCommon);
    assert.deepEqual(result.speed, {
      walk: 20, burrow: 20, climb: null, fly: null, swim: 30, special: null,
    });
  });

  it('returns nulls for missing speed', () => {
    const html = '';
    const result = parseStatblockOffense(html, mockCommon);
    assert.deepEqual(result.speed, {
      walk: null, burrow: null, climb: null, fly: null, swim: null, special: null,
    });
  });
});

describe('parseStatblockOffense — strikes parsing', () => {
  it('parses simple melee strike', () => {
    const html = `
      <span class="hanging-indent">
        <b>Melee</b> <span class="action">[one-action]</span> jaws +15, <b>Damage</b> 2d12+5 piercing
      </span>
    `;
    const result = parseStatblockOffense(html, mockCommon);
    assert.equal(result.strikes.length, 1);
    const strike = result.strikes[0]!;
    assert.equal(strike.kind, 'melee');
    assert.equal(strike.weapon, 'jaws');
    assert.equal(strike.attack_bonus, 15);
  });

  it('parses strike with MAP bonuses', () => {
    const html = `
      <span class="hanging-indent">
        <b>Ranged</b> <span class="action">[one-action]</span> bow +12 [-7/-12], <b>Damage</b> 2d8 piercing
      </span>
    `;
    const result = parseStatblockOffense(html, mockCommon);
    assert.equal(result.strikes.length, 1);
    const strike = result.strikes[0]!;
    assert.equal(strike.kind, 'ranged');
    assert.deepEqual(strike.map_bonuses, [-7, -12]);
  });

  it('parses strike with traits', () => {
    const html = `
      <span class="hanging-indent">
        <b>Melee</b> claw +14 (agile, finesse), <b>Damage</b> 1d8+4 slashing
      </span>
    `;
    const result = parseStatblockOffense(html, mockCommon);
    assert.equal(result.strikes.length, 1);
    const strike = result.strikes[0]!;
    assert.deepEqual(strike.traits, ['agile', 'finesse']);
  });

  it('parses strike with persistent damage', () => {
    const html = `
      <span class="hanging-indent">
        <b>Melee</b> fangs +16, <b>Damage</b> 2d8+6 piercing plus persistent 2d6 poison
      </span>
    `;
    const result = parseStatblockOffense(html, mockCommon);
    assert.equal(result.strikes.length, 1);
    const strike = result.strikes[0]!;
    assert.equal(strike.damage.length, 2);
    assert.equal(strike.damage[1]!.persistent, true);
  });

  it('returns empty array for missing strikes', () => {
    const html = '';
    const result = parseStatblockOffense(html, mockCommon);
    assert.deepEqual(result.strikes, []);
  });
});

describe('parseStatblockOffense — spell lists parsing', () => {
  it('parses innate spells from fields', () => {
    const html = '';
    const mockWithFields: CommonExtraction = {
      ...mockCommon,
      fields: [
        {
          label: 'Innate Spells',
          value_text: 'DC 25',
          value_html: 'DC 25<br/><b>1st</b> charm, <b>2nd</b> mirror image',
          order: 0,
        },
      ],
    };
    const result = parseStatblockOffense(html, mockWithFields);
    assert.equal(result.spell_lists.length, 1);
    const list = result.spell_lists[0]!;
    assert.equal(list.kind, 'innate');
    assert.equal(list.dc, 25);
  });

  it('parses spells with tradition from fields', () => {
    const html = '';
    const mockWithFields: CommonExtraction = {
      ...mockCommon,
      fields: [
        {
          label: 'Arcane Spells',
          value_text: 'DC 22, attack +14',
          value_html: 'DC 22, attack +14<br/><b>3rd</b> fireball',
          order: 0,
        },
      ],
    };
    const result = parseStatblockOffense(html, mockWithFields);
    assert.equal(result.spell_lists.length, 1);
    const list = result.spell_lists[0]!;
    assert.equal(list.tradition, 'Arcane');
    assert.equal(list.kind, 'spells');
  });

  it('returns empty array for missing spells', () => {
    const html = '';
    const result = parseStatblockOffense(html, mockCommon);
    assert.deepEqual(result.spell_lists, []);
  });
});

describe('parseStatblockOffense — complete offense section', () => {
  it('parses full offense section', () => {
    const html = `
      <b>Speed</b> 30 feet, fly 60 feet<br/>
      <span class="hanging-indent">
        <b>Melee</b> <span class="action">[one-action]</span> bite +16, <b>Damage</b> 2d10+6 piercing
      </span>
      <span class="hanging-indent">
        <b>Ranged</b> <span class="action">[one-action]</span> ray +14, <b>Damage</b> 3d6 fire
      </span>
    `;
    const result = parseStatblockOffense(html, mockCommon);
    assert.equal(result.speed.walk, 30);
    assert.equal(result.speed.fly, 60);
    assert.equal(result.strikes.length, 2);
    assert.equal(result.strikes[0]!.kind, 'melee');
    assert.equal(result.strikes[1]!.kind, 'ranged');
  });
});
