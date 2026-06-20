// Unit tests for monster-family concept capability nodes.
import { describe, it } from 'node:test';
import { Batch } from '@studnicky/dagonizer';
import assert from 'node:assert/strict';

import { loadAndCommonNode }   from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import { sectionWalkerNode }   from '../../../../../plugins/aonprd/capabilities/sectionWalker.js';
import { sourceRefNode }       from '../../../../../plugins/aonprd/capabilities/sourceRef.js';
import {
  monsterFamilyBaseNode,
  monsterFamilyMembersNode,
  finalizeMonsterFamilyNode,
} from '../../../../../plugins/aonprd/concepts/monster-family.js';
import type { MonsterFamilyOutput } from '../../../../../plugins/aonprd/concepts/monster-family.js';
import { loadFixture, makeState, stubContext } from '../nodes/helpers.js';
import { ParsedOutput } from '../../../../helpers/ParsedOutput.js';

const FIXTURE  = 'monster-family-elemental-metal.html';
const BASE_URL = 'https://2e.aonprd.com/MonsterFamilies.aspx?ID=343';

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
  await monsterFamilyBaseNode.execute(Batch.of(state), stubContext);
  await monsterFamilyMembersNode.execute(Batch.of(state), stubContext);
  await finalizeMonsterFamilyNode.execute(Batch.of(state), stubContext);
  return ParsedOutput.as<MonsterFamilyOutput>(state.output);
}

describe('extract:monster-family-base — elemental-metal', () => {
  it('produces _type, url, name, monster_family_id', async () => {
    const state = await primeState(FIXTURE, BASE_URL);
    const result = await monsterFamilyBaseNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<MonsterFamilyOutput>(state.output);
    assert.equal(out.monster_family_id, 343);
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name should be non-empty');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', BASE_URL);
    const result = await monsterFamilyBaseNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });
});

describe('extract:monster-family-members — elemental-metal', () => {
  it('produces members array', async () => {
    const state = await primeState(FIXTURE, BASE_URL);
    await monsterFamilyBaseNode.execute(Batch.of(state), stubContext);
    const result = await monsterFamilyMembersNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<MonsterFamilyOutput>(state.output);
    assert.ok(Array.isArray(out.members), 'members should be an array');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', BASE_URL);
    const result = await monsterFamilyMembersNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });
});

describe('finalize:monster-family — elemental-metal', () => {
  it('produces complete MonsterFamilyOutput', async () => {
    const out = await primeAndRunFull(FIXTURE, BASE_URL);
    assert.equal(out.monster_family_id, 343);
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name missing');
    assert.ok(Array.isArray(out.members), 'members missing');
    assert.ok(Array.isArray(out.links), 'links missing');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
    assert.ok(typeof out.body_text === 'string', 'body_text missing');
  });

  it('error path — soft-fails to success when prerequisites missing', async () => {
    const state = makeState('', BASE_URL);
    const result = await finalizeMonsterFamilyNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));
  });
});
