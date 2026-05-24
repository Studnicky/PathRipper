// Unit tests for siege-weapon concept capability nodes (Phase 6.4).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { loadAndCommonNode }           from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import { sectionWalkerNode }           from '../../../../../plugins/aonprd/capabilities/sectionWalker.js';
import { labelPairBlockNode }          from '../../../../../plugins/aonprd/capabilities/labelPairBlock.js';
import { sourceRefNode }               from '../../../../../plugins/aonprd/capabilities/sourceRef.js';
import {
  siegeWeaponBaseNode,
  siegeWeaponMechanicsNode,
  finalizeSiegeWeaponNode,
} from '../../../../../plugins/aonprd/concepts/siege-weapon.js';
import type { SiegeWeaponOutput } from '../../../../../plugins/aonprd/concepts/siege-weapon.js';
import { loadFixture, makeState, stubContext } from '../nodes/helpers.js';

async function primeState(fixtureName: string, url: string) {
  const html  = await loadFixture(fixtureName);
  const state = makeState(html, url);
  await loadAndCommonNode.execute(state, stubContext);
  await labelPairBlockNode.execute(state, stubContext);
  await sectionWalkerNode.execute(state, stubContext);
  await sourceRefNode.execute(state, stubContext);
  return state;
}

async function primeAndRunFull(fixtureName: string, url: string) {
  const state = await primeState(fixtureName, url);
  await siegeWeaponBaseNode.execute(state, stubContext);
  await siegeWeaponMechanicsNode.execute(state, stubContext);
  await finalizeSiegeWeaponNode.execute(state, stubContext);
  return state.output as SiegeWeaponOutput;
}

describe('extract:siege-weapon-base — siege-weapon-volley-gun', () => {
  it('produces _type, name, siege_weapon_id', async () => {
    const state = await primeState('siege-weapon-volley-gun.html', 'https://2e.aonprd.com/SiegeWeapons.aspx?ID=1');
    const r = await siegeWeaponBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as SiegeWeaponOutput;
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name should be non-empty');
    assert.equal(out.siege_weapon_id, 1);
  });

  it('captures source', async () => {
    const state = await primeState('siege-weapon-volley-gun.html', 'https://2e.aonprd.com/SiegeWeapons.aspx?ID=1');
    await siegeWeaponBaseNode.execute(state, stubContext);
    const out = state.output as SiegeWeaponOutput;
    assert.ok(out.source !== undefined, 'source missing');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/SiegeWeapons.aspx?ID=1');
    const r = await siegeWeaponBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('extract:siege-weapon-mechanics — siege-weapon-volley-gun', () => {
  it('produces price, crew, ac, hp fields', async () => {
    const state = await primeState('siege-weapon-volley-gun.html', 'https://2e.aonprd.com/SiegeWeapons.aspx?ID=1');
    await siegeWeaponBaseNode.execute(state, stubContext);
    const r = await siegeWeaponMechanicsNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as SiegeWeaponOutput;
    assert.ok('price' in out, 'price missing');
    assert.ok('crew' in out, 'crew missing');
    assert.ok('ac' in out, 'ac missing');
    assert.ok('hp' in out, 'hp missing');
    assert.ok('hardness' in out, 'hardness missing');
  });

  it('error path — returns error when prerequisites missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/SiegeWeapons.aspx?ID=1');
    const r = await siegeWeaponMechanicsNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('finalize:siege-weapon — siege-weapon-volley-gun', () => {
  it('produces operator_actions, description, sections, raw_fields', async () => {
    const state = await primeState('siege-weapon-volley-gun.html', 'https://2e.aonprd.com/SiegeWeapons.aspx?ID=1');
    await siegeWeaponBaseNode.execute(state, stubContext);
    await siegeWeaponMechanicsNode.execute(state, stubContext);
    const r = await finalizeSiegeWeaponNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as SiegeWeaponOutput;
    assert.ok(Array.isArray(out.operator_actions), 'operator_actions missing');
    assert.ok('description_text' in out, 'description_text missing');
    assert.ok(Array.isArray(out.sections), 'sections missing');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
  });

  it('error path — soft-fails to success when prerequisites missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/SiegeWeapons.aspx?ID=1');
    const r = await finalizeSiegeWeaponNode.execute(state, stubContext);
    assert.equal(r.output, 'success');
  });
});

describe('full siege-weapon pipeline — siege-weapon-volley-gun', () => {
  it('produces complete SiegeWeaponOutput', async () => {
    const out = await primeAndRunFull('siege-weapon-volley-gun.html', 'https://2e.aonprd.com/SiegeWeapons.aspx?ID=1');
    assert.equal(out.siege_weapon_id, 1);
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name missing');
    assert.ok(Array.isArray(out.operator_actions), 'operator_actions missing');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
  });
});
