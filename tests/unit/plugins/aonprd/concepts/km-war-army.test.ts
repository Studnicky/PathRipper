// Unit tests for km-war-army concept capability nodes.
import { describe, it } from 'node:test';
import { Batch } from '@studnicky/dagonizer';
import assert from 'node:assert/strict';

import { loadAndCommonNode }         from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import {
  kmWarArmyBaseNode,
  kmWarArmyStatblockNode,
  kmWarArmyAbilitiesNode,
  finalizeKmWarArmyNode,
} from '../../../../../plugins/aonprd/concepts/km-war-army.js';
import type { KmWarArmyOutput } from '../../../../../plugins/aonprd/concepts/km-war-army.js';
import { loadFixture, makeState, stubContext } from '../nodes/helpers.js';
import { ParsedOutput } from '../../../../helpers/ParsedOutput.js';

const FIXTURE = 'km-war-army-greengripe-bombardiers.html';
const URL     = 'https://2e.aonprd.com/KMWarArmies.aspx?ID=12';

async function primeState() {
  const html  = await loadFixture(FIXTURE);
  const state = makeState(html, URL);
  await loadAndCommonNode.execute(Batch.of(state), stubContext);
  return state;
}

async function primeAndRunFull() {
  const state = await primeState();
  await kmWarArmyBaseNode.execute(Batch.of(state), stubContext);
  await kmWarArmyStatblockNode.execute(Batch.of(state), stubContext);
  await kmWarArmyAbilitiesNode.execute(Batch.of(state), stubContext);
  await finalizeKmWarArmyNode.execute(Batch.of(state), stubContext);
  return ParsedOutput.as<KmWarArmyOutput>(state.output);
}

describe('extract:km-war-army-base — km-war-army-greengripe-bombardiers', () => {
  it('produces _type, name, army_id, and ancestry', async () => {
    const state = await primeState();
    const result = await kmWarArmyBaseNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<KmWarArmyOutput>(state.output);
    assert.equal(out.name, 'Greengripe Bombardiers');
    assert.equal(out.army_id, 12);
    assert.ok(Array.isArray(out.traits), 'traits is array');
    assert.ok('ancestry' in out, 'ancestry field present');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', URL);
    const result = await kmWarArmyBaseNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });
});

describe('extract:km-war-army-statblock — km-war-army-greengripe-bombardiers', () => {
  it('produces statblock fields (ac, hp, etc.)', async () => {
    const state = await primeState();
    await kmWarArmyBaseNode.execute(Batch.of(state), stubContext);
    const result = await kmWarArmyStatblockNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<KmWarArmyOutput>(state.output);
    assert.ok('ac' in out, 'ac field present');
    assert.ok('hp' in out, 'hp field present');
    assert.ok('maneuver' in out, 'maneuver field present');
    assert.ok('morale' in out, 'morale field present');
    assert.ok('scouting' in out, 'scouting field present');
    assert.ok('recruitment' in out, 'recruitment field present');
    assert.ok('consumption' in out, 'consumption field present');
    assert.ok('description' in out, 'description field present');
    assert.ok('melee' in out, 'melee field present');
    assert.ok('ranged' in out, 'ranged field present');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', URL);
    const result = await kmWarArmyStatblockNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });
});

describe('extract:km-war-army-abilities — km-war-army-greengripe-bombardiers', () => {
  it('produces abilities array', async () => {
    const state = await primeState();
    await kmWarArmyBaseNode.execute(Batch.of(state), stubContext);
    await kmWarArmyStatblockNode.execute(Batch.of(state), stubContext);
    const result = await kmWarArmyAbilitiesNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<KmWarArmyOutput>(state.output);
    assert.ok(Array.isArray(out.abilities), 'abilities is array');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', URL);
    const result = await kmWarArmyAbilitiesNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });
});

describe('finalize:km-war-army — km-war-army-greengripe-bombardiers', () => {
  it('assembles complete KmWarArmyOutput with all required fields', async () => {
    const out = await primeAndRunFull();
    assert.equal(out.name, 'Greengripe Bombardiers');
    assert.equal(out.army_id, 12);
    assert.ok(Array.isArray(out.abilities), 'abilities present');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields present');
    assert.ok(typeof out.body_html === 'string', 'body_html present');
    assert.ok(Array.isArray(out.links), 'links present');
    assert.ok('meta_description' in out, 'meta_description present');
    assert.ok('meta_keywords' in out, 'meta_keywords present');
    assert.ok(Array.isArray(out.sections), 'sections present');
  });

  it('strips claimed AON labels from raw_fields', async () => {
    const out = await primeAndRunFull();
    assert.equal(out.raw_fields['Source'], undefined, 'Source stripped');
    assert.equal(out.raw_fields['AC'], undefined, 'AC stripped');
    assert.equal(out.raw_fields['HP'], undefined, 'HP stripped');
    assert.equal(out.raw_fields['Recruitment'], undefined, 'Recruitment stripped');
  });

  it('error path — soft-fails to success when prerequisites missing', async () => {
    const state = makeState('', URL);
    const result = await finalizeKmWarArmyNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));
  });
});
