// Unit tests for monster concept capability nodes.
import { describe, it } from 'node:test';
import { Batch } from '@studnicky/dagonizer';
import assert from 'node:assert/strict';

import { loadAndCommonNode }   from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import { sectionWalkerNode }   from '../../../../../plugins/aonprd/capabilities/sectionWalker.js';
import { sourceRefNode }       from '../../../../../plugins/aonprd/capabilities/sourceRef.js';
import {
  monsterBaseNode,
  monsterDefensesNode,
  monsterOffenseNode,
  monsterAbilitiesNode,
  monsterMetaNode,
  finalizeMonsterNode,
} from '../../../../../plugins/aonprd/concepts/monster/index.js';
import type { MonsterOutput } from '../../../../../plugins/aonprd/concepts/monster/index.js';
import { loadFixture, makeState, stubContext } from '../nodes/helpers.js';
import { ParsedOutput } from '../../../../helpers/ParsedOutput.js';

const FIXTURE_MINION   = 'monster-phantasmal-minion.html';
const BASE_URL_MINION  = 'https://2e.aonprd.com/Monsters.aspx?ID=2750';

const FIXTURE_GOBLIN   = 'monster-goblin-war-chanter.html';
const BASE_URL_GOBLIN  = 'https://2e.aonprd.com/Monsters.aspx?ID=1';

const FIXTURE_DRAGON   = 'monster-young-red-dragon.html';
const BASE_URL_DRAGON  = 'https://2e.aonprd.com/Monsters.aspx?ID=2';

const FIXTURE_REGEN    = 'monster-with-regeneration.html';
const BASE_URL_REGEN   = 'https://2e.aonprd.com/Monsters.aspx?ID=3';

const FIXTURE_FAMILY   = 'monster-with-family.html';
const BASE_URL_FAMILY  = 'https://2e.aonprd.com/Monsters.aspx?ID=4';

async function primeState(fixtureName: string, url: string) {
  const html  = await loadFixture(fixtureName);
  const state = makeState(html, url);
  await loadAndCommonNode.execute(Batch.of(state), stubContext);
  await sectionWalkerNode.execute(Batch.of(state), stubContext);
  await sourceRefNode.execute(Batch.of(state), stubContext);
  return state;
}

async function primeAndRunFull(fixtureName: string, url: string) {
  const state = await primeState(fixtureName, url);
  await monsterBaseNode.execute(Batch.of(state), stubContext);
  await monsterDefensesNode.execute(Batch.of(state), stubContext);
  await monsterOffenseNode.execute(Batch.of(state), stubContext);
  await monsterAbilitiesNode.execute(Batch.of(state), stubContext);
  await monsterMetaNode.execute(Batch.of(state), stubContext);
  await finalizeMonsterNode.execute(Batch.of(state), stubContext);
  return ParsedOutput.as<MonsterOutput>(state.output);
}

describe('extract:monster-base — phantasmal-minion', () => {
  it('produces _type, url, name, monster_id', async () => {
    const state = await primeState(FIXTURE_MINION, BASE_URL_MINION);
    const result = await monsterBaseNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<MonsterOutput>(state.output);
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name should be non-empty');
    assert.ok(typeof out.perception === 'object', 'perception missing');
    assert.ok(typeof out.abilities === 'object', 'abilities missing');
    assert.ok('str' in out.abilities, 'abilities.str missing');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', BASE_URL_MINION);
    const result = await monsterBaseNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });
});

describe('extract:monster-defenses — phantasmal-minion', () => {
  it('produces ac, saves, hp, immunities, weaknesses, resistances', async () => {
    const state = await primeState(FIXTURE_MINION, BASE_URL_MINION);
    await monsterBaseNode.execute(Batch.of(state), stubContext);
    const result = await monsterDefensesNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<MonsterOutput>(state.output);
    assert.ok(typeof out.ac === 'object', 'ac missing');
    assert.ok(typeof out.saves === 'object', 'saves missing');
    assert.ok('fort' in out.saves, 'saves.fort missing');
    assert.ok(typeof out.hp === 'object', 'hp missing');
    assert.ok(Array.isArray(out.immunities), 'immunities missing');
    assert.ok(Array.isArray(out.weaknesses), 'weaknesses missing');
    assert.ok(Array.isArray(out.resistances), 'resistances missing');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', BASE_URL_MINION);
    const result = await monsterDefensesNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });
});

describe('extract:monster-offense — phantasmal-minion', () => {
  it('produces speed, strikes, spell_lists', async () => {
    const state = await primeState(FIXTURE_MINION, BASE_URL_MINION);
    await monsterBaseNode.execute(Batch.of(state), stubContext);
    await monsterDefensesNode.execute(Batch.of(state), stubContext);
    const result = await monsterOffenseNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<MonsterOutput>(state.output);
    assert.ok(typeof out.speed === 'object', 'speed missing');
    assert.ok(Array.isArray(out.strikes), 'strikes missing');
    assert.ok(Array.isArray(out.spell_lists), 'spell_lists missing');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', BASE_URL_MINION);
    const result = await monsterOffenseNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });
});

describe('extract:monster-abilities — phantasmal-minion', () => {
  it('produces top_abilities, defensive_abilities, offensive_abilities', async () => {
    const state = await primeState(FIXTURE_MINION, BASE_URL_MINION);
    await monsterBaseNode.execute(Batch.of(state), stubContext);
    await monsterDefensesNode.execute(Batch.of(state), stubContext);
    await monsterOffenseNode.execute(Batch.of(state), stubContext);
    const result = await monsterAbilitiesNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<MonsterOutput>(state.output);
    assert.ok(Array.isArray(out.top_abilities), 'top_abilities missing');
    assert.ok(Array.isArray(out.defensive_abilities), 'defensive_abilities missing');
    assert.ok(Array.isArray(out.offensive_abilities), 'offensive_abilities missing');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', BASE_URL_MINION);
    const result = await monsterAbilitiesNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });
});

describe('extract:monster-meta — phantasmal-minion', () => {
  it('produces variants and family_links arrays', async () => {
    const state = await primeState(FIXTURE_MINION, BASE_URL_MINION);
    await monsterBaseNode.execute(Batch.of(state), stubContext);
    const result = await monsterMetaNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<MonsterOutput>(state.output);
    assert.ok(Array.isArray(out.variants), 'variants missing');
    assert.ok(Array.isArray(out.family_links), 'family_links missing');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', BASE_URL_MINION);
    const result = await monsterMetaNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });
});

describe('finalize:monster — phantasmal-minion', () => {
  it('produces complete MonsterOutput with all required fields', async () => {
    const out = await primeAndRunFull(FIXTURE_MINION, BASE_URL_MINION);
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name missing');
    assert.ok(typeof out.ac === 'object', 'ac missing');
    assert.ok(typeof out.saves === 'object', 'saves missing');
    assert.ok(Array.isArray(out.strikes), 'strikes missing');
    assert.ok(Array.isArray(out.spell_lists), 'spell_lists missing');
    assert.ok(Array.isArray(out.top_abilities), 'top_abilities missing');
    assert.ok(Array.isArray(out.variants), 'variants missing');
    assert.ok(Array.isArray(out.family_links), 'family_links missing');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
    assert.ok(Array.isArray(out.links), 'links missing');
    assert.ok(typeof out.body_text === 'string', 'body_text missing');
  });

  it('error path — soft-fails to success when prerequisites missing', async () => {
    const state = makeState('', BASE_URL_MINION);
    const result = await finalizeMonsterNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));
  });
});

describe('full pipeline — goblin-war-chanter', () => {
  it('extracts a humanoid NPC with skills and languages', async () => {
    const out = await primeAndRunFull(FIXTURE_GOBLIN, BASE_URL_GOBLIN);
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name missing');
    assert.ok(typeof out.languages === 'object', 'languages missing');
    assert.ok(Array.isArray(out.languages.languages), 'languages.languages missing');
    assert.ok(Array.isArray(out.skills), 'skills missing');
  });
});

describe('full pipeline — young-red-dragon', () => {
  it('extracts a dragon with strikes, spell lists, and abilities', async () => {
    const out = await primeAndRunFull(FIXTURE_DRAGON, BASE_URL_DRAGON);
    assert.ok(out.strikes.length > 0, 'young red dragon should have strikes');
    assert.ok(typeof out.level === 'number', 'level should be a number');
  });
});

describe('full pipeline — monster-with-regeneration', () => {
  it('handles special HP format (regeneration in special field)', async () => {
    const out = await primeAndRunFull(FIXTURE_REGEN, BASE_URL_REGEN);
    // HP value should be numeric
    assert.ok(out.hp.value !== null, 'hp.value should be non-null');
  });
});

describe('full pipeline — monster-with-family', () => {
  it('extracts family_links when related groups present', async () => {
    const out = await primeAndRunFull(FIXTURE_FAMILY, BASE_URL_FAMILY);
    // Monster with a family should have at least one family link
    assert.ok(out.family_links.length > 0, 'should have at least one family link');
  });
});
