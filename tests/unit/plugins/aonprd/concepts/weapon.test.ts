// Unit tests for weapon concept capability nodes (Phase 6.4).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { loadAndCommonNode }           from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import { sectionWalkerNode }           from '../../../../../plugins/aonprd/capabilities/sectionWalker.js';
import { labelPairBlockNode }          from '../../../../../plugins/aonprd/capabilities/labelPairBlock.js';
import { sourceRefNode }               from '../../../../../plugins/aonprd/capabilities/sourceRef.js';
import {
  weaponBaseNode,
  weaponMechanicsNode,
  finalizeWeaponNode,
} from '../../../../../plugins/aonprd/concepts/weapon/index.js';
import type { WeaponOutput } from '../../../../../plugins/aonprd/concepts/weapon/index.js';
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
  await weaponBaseNode.execute(state, stubContext);
  await weaponMechanicsNode.execute(state, stubContext);
  await finalizeWeaponNode.execute(state, stubContext);
  return state.output as WeaponOutput;
}

describe('extract:weapon-base — weapon-longsword', () => {
  it('produces _type, name, weapon_id', async () => {
    const state = await primeState('weapon-longsword.html', 'https://2e.aonprd.com/Weapons.aspx?ID=300');
    const r = await weaponBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as WeaponOutput;
    assert.equal(out._type, 'weapon');
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name should be non-empty');
    assert.equal(out.weapon_id, 300);
  });

  it('captures source and traits', async () => {
    const state = await primeState('weapon-longsword.html', 'https://2e.aonprd.com/Weapons.aspx?ID=300');
    await weaponBaseNode.execute(state, stubContext);
    const out = state.output as WeaponOutput;
    assert.ok(out.source !== undefined, 'source missing');
    assert.ok(Array.isArray(out.traits), 'traits should be array');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Weapons.aspx?ID=300');
    const r = await weaponBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('extract:weapon-mechanics — weapon-longsword', () => {
  it('produces price, damage, bulk, hands, category, group', async () => {
    const state = await primeState('weapon-longsword.html', 'https://2e.aonprd.com/Weapons.aspx?ID=300');
    await weaponBaseNode.execute(state, stubContext);
    const r = await weaponMechanicsNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as WeaponOutput;
    assert.ok('price' in out, 'price missing');
    assert.ok('damage' in out, 'damage missing');
    assert.ok('bulk' in out, 'bulk missing');
    assert.ok('hands' in out, 'hands missing');
    assert.ok('category' in out, 'category missing');
    assert.ok('group' in out, 'group missing');
  });

  it('error path — returns error when prerequisites missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Weapons.aspx?ID=300');
    const r = await weaponMechanicsNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('finalize:weapon — weapon-longsword', () => {
  it('produces raw_fields, links, meta fields', async () => {
    const state = await primeState('weapon-longsword.html', 'https://2e.aonprd.com/Weapons.aspx?ID=300');
    await weaponBaseNode.execute(state, stubContext);
    await weaponMechanicsNode.execute(state, stubContext);
    const r = await finalizeWeaponNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as WeaponOutput;
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
    assert.ok(Array.isArray(out.links), 'links missing');
    assert.ok('meta_description' in out, 'meta_description missing');
    assert.ok('meta_keywords' in out, 'meta_keywords missing');
  });

  it('error path — soft-fails to success when prerequisites missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Weapons.aspx?ID=300');
    const r = await finalizeWeaponNode.execute(state, stubContext);
    assert.equal(r.output, 'success');
  });
});

describe('full weapon pipeline — weapon-longsword', () => {
  it('produces complete WeaponOutput', async () => {
    const out = await primeAndRunFull('weapon-longsword.html', 'https://2e.aonprd.com/Weapons.aspx?ID=300');
    assert.equal(out._type, 'weapon');
    assert.equal(out.weapon_id, 300);
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name missing');
    assert.ok('price' in out, 'price missing');
    assert.ok('damage' in out, 'damage missing');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
    assert.ok('pfs_note' in out, 'pfs_note field missing');
  });
});
