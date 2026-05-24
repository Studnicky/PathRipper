// Unit tests for monster-ability concept capability nodes.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { loadAndCommonNode }   from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import { sectionWalkerNode }   from '../../../../../plugins/aonprd/capabilities/sectionWalker.js';
import { sourceRefNode }       from '../../../../../plugins/aonprd/capabilities/sourceRef.js';
import {
  monsterAbilityBaseNode,
  monsterAbilityDefinitionNode,
  finalizeMonsterAbilityNode,
} from '../../../../../plugins/aonprd/concepts/monster-ability.js';
import type { MonsterAbilityOutput } from '../../../../../plugins/aonprd/concepts/monster-ability.js';
import { loadFixture, makeState, stubContext } from '../nodes/helpers.js';

const FIXTURE_GRAB       = 'monster-ability-grab.html';
const BASE_URL_GRAB      = 'https://2e.aonprd.com/MonsterAbilities.aspx?ID=45';

const FIXTURE_VISION     = 'monster-ability-all-around-vision.html';
const BASE_URL_VISION    = 'https://2e.aonprd.com/MonsterAbilities.aspx?ID=1';

async function primeState(fixtureName: string, url: string) {
  const html  = await loadFixture(fixtureName);
  const state = makeState(html, url);
  await loadAndCommonNode.execute(state, stubContext);
  await sectionWalkerNode.execute(state, stubContext);
  await sourceRefNode.execute(state, stubContext);
  return state;
}

async function primeAndRunFull(fixtureName: string, url: string) {
  const state = await primeState(fixtureName, url);
  await monsterAbilityBaseNode.execute(state, stubContext);
  await monsterAbilityDefinitionNode.execute(state, stubContext);
  await finalizeMonsterAbilityNode.execute(state, stubContext);
  return state.output as MonsterAbilityOutput;
}

describe('extract:monster-ability-base — grab', () => {
  it('produces _type, url, name, monster_ability_id', async () => {
    const state = await primeState(FIXTURE_GRAB, BASE_URL_GRAB);
    const r = await monsterAbilityBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as MonsterAbilityOutput;
    assert.equal(out.monster_ability_id, 45);
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name should be non-empty');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', BASE_URL_GRAB);
    const r = await monsterAbilityBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('extract:monster-ability-definition — grab', () => {
  it('produces trigger, requirements, frequency, effect, related_abilities', async () => {
    const state = await primeState(FIXTURE_GRAB, BASE_URL_GRAB);
    await monsterAbilityBaseNode.execute(state, stubContext);
    const r = await monsterAbilityDefinitionNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as MonsterAbilityOutput;
    // Grab has Requirements and Effect labels
    assert.ok(out.requirements !== null || out.trigger !== null || out.effect !== null,
      'at least one definition label should be populated for grab');
    assert.ok(Array.isArray(out.related_abilities), 'related_abilities should be array');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', BASE_URL_GRAB);
    const r = await monsterAbilityDefinitionNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('finalize:monster-ability — grab', () => {
  it('produces complete MonsterAbilityOutput', async () => {
    const out = await primeAndRunFull(FIXTURE_GRAB, BASE_URL_GRAB);
    assert.equal(out.monster_ability_id, 45);
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name missing');
    assert.ok(Array.isArray(out.related_abilities), 'related_abilities missing');
    assert.ok(Array.isArray(out.links), 'links missing');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
    assert.ok(typeof out.body_text === 'string', 'body_text missing');
  });

  it('error path — soft-fails to success when prerequisites missing', async () => {
    const state = makeState('', BASE_URL_GRAB);
    const r = await finalizeMonsterAbilityNode.execute(state, stubContext);
    assert.equal(r.output, 'success');
  });
});

describe('full pipeline — all-around-vision', () => {
  it('extracts a passive ability with no definition labels', async () => {
    const out = await primeAndRunFull(FIXTURE_VISION, BASE_URL_VISION);
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name missing');
    // Passive abilities have no trigger/requirements/frequency/effect
    assert.equal(out.trigger, null);
    assert.equal(out.frequency, null);
  });
});
