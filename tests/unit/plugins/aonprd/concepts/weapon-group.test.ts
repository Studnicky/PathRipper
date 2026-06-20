// Unit tests for weapon-group concept capability nodes.
import { describe, it } from 'node:test';
import { Batch } from '@studnicky/dagonizer';
import assert from 'node:assert/strict';

import { loadAndCommonNode }           from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import { sectionWalkerNode }           from '../../../../../plugins/aonprd/capabilities/sectionWalker.js';
import { labelPairBlockNode }          from '../../../../../plugins/aonprd/capabilities/labelPairBlock.js';
import { sourceRefNode }               from '../../../../../plugins/aonprd/capabilities/sourceRef.js';
import {
  weaponGroupBaseNode,
  weaponGroupContentNode,
  finalizeWeaponGroupNode,
} from '../../../../../plugins/aonprd/concepts/weapon-group.js';
import type { WeaponGroupOutput } from '../../../../../plugins/aonprd/concepts/weapon-group.js';
import { loadFixture, makeState, stubContext } from '../nodes/helpers.js';
import { ParsedOutput } from '../../../../helpers/ParsedOutput.js';

async function primeState(fixtureName: string, url: string) {
  const html  = await loadFixture(fixtureName);
  const state = makeState(html, url);
  await loadAndCommonNode.execute(Batch.of(state), stubContext);
  await labelPairBlockNode.execute(Batch.of(state), stubContext);
  await sectionWalkerNode.execute(Batch.of(state), stubContext);
  await sourceRefNode.execute(Batch.of(state), stubContext);
  return state;
}

async function primeAndRunFull(fixtureName: string, url: string) {
  const state = await primeState(fixtureName, url);
  await weaponGroupBaseNode.execute(Batch.of(state), stubContext);
  await weaponGroupContentNode.execute(Batch.of(state), stubContext);
  await finalizeWeaponGroupNode.execute(Batch.of(state), stubContext);
  return ParsedOutput.as<WeaponGroupOutput>(state.output);
}

describe('extract:weapon-group-base — weapon-group-axe', () => {
  it('produces _type, name, group_id', async () => {
    const state = await primeState('weapon-group-axe.html', 'https://2e.aonprd.com/WeaponGroups.aspx?ID=1');
    const result = await weaponGroupBaseNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<WeaponGroupOutput>(state.output);
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name should be non-empty');
    assert.equal(out.group_id, 1);
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/WeaponGroups.aspx?ID=1');
    const result = await weaponGroupBaseNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });
});

describe('extract:weapon-group-content — weapon-group-axe', () => {
  it('produces critical_specialization_html/text and weapons[]', async () => {
    const state = await primeState('weapon-group-axe.html', 'https://2e.aonprd.com/WeaponGroups.aspx?ID=1');
    await weaponGroupBaseNode.execute(Batch.of(state), stubContext);
    const result = await weaponGroupContentNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<WeaponGroupOutput>(state.output);
    assert.ok(typeof out.critical_specialization_html === 'string', 'critical_specialization_html missing');
    assert.ok(typeof out.critical_specialization_text === 'string', 'critical_specialization_text missing');
    assert.ok(Array.isArray(out.weapons), 'weapons should be an array');
    assert.ok(out.weapons.length > 0, 'axe group should have weapons listed');
  });

  it('weapons carry name and weapon_id', async () => {
    const state = await primeState('weapon-group-axe.html', 'https://2e.aonprd.com/WeaponGroups.aspx?ID=1');
    await weaponGroupBaseNode.execute(Batch.of(state), stubContext);
    await weaponGroupContentNode.execute(Batch.of(state), stubContext);

    const out = ParsedOutput.as<WeaponGroupOutput>(state.output);
    const first = out.weapons[0];
    assert.ok(first !== undefined, 'no weapons in list');
    assert.ok(typeof first.name === 'string' && first.name.length > 0, 'weapon name missing');
    assert.ok(first.weapon_id === null || typeof first.weapon_id === 'number', 'weapon_id should be null or number');
  });

  it('error path — returns error when aonprdTarget missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/WeaponGroups.aspx?ID=1');
    const result = await weaponGroupContentNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });
});

describe('full weapon-group pipeline — weapon-group-axe', () => {
  it('produces complete WeaponGroupOutput', async () => {
    const out = await primeAndRunFull('weapon-group-axe.html', 'https://2e.aonprd.com/WeaponGroups.aspx?ID=1');
    assert.equal(out.group_id, 1);
    assert.ok(out.critical_specialization_text.length > 0, 'critical_specialization_text should be non-empty');
    assert.ok(out.weapons.length > 0, 'weapons should be non-empty');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
  });
});

describe('full weapon-group pipeline — weapon-group-club', () => {
  it('produces valid WeaponGroupOutput', async () => {
    const out = await primeAndRunFull('weapon-group-club.html', 'https://2e.aonprd.com/WeaponGroups.aspx?ID=2');
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name missing');
  });
});
