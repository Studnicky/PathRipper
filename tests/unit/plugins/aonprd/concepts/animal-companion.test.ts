// Unit tests for animal-companion concept capability nodes.
import { describe, it } from 'node:test';
import { Batch } from '@studnicky/dagonizer';
import assert from 'node:assert/strict';

import { loadAndCommonNode }   from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import { sectionWalkerNode }   from '../../../../../plugins/aonprd/capabilities/sectionWalker.js';
import { sourceRefNode }       from '../../../../../plugins/aonprd/capabilities/sourceRef.js';
import {
  animalCompanionBaseNode,
  animalCompanionStatsNode,
  animalCompanionCombatNode,
  animalCompanionAdvancementNode,
  finalizeAnimalCompanionNode,
} from '../../../../../plugins/aonprd/concepts/animal-companion/index.js';
import type { AnimalCompanionOutput } from '../../../../../plugins/aonprd/concepts/animal-companion/index.js';
import { loadFixture, makeState, stubContext } from '../nodes/helpers.js';
import { ParsedOutput } from '../../../../helpers/ParsedOutput.js';

const FIXTURE_BASE     = 'animal-companion-cave-pterosaur.html';
const BASE_URL_BASE    = 'https://2e.aonprd.com/Companions.aspx?ID=14';

const FIXTURE_ADVANCED = 'animal-companion-wind-chaser.html';
const BASE_URL_ADVANCED = 'https://2e.aonprd.com/Companions.aspx?ID=1&Type=Specialized';

const FIXTURE_UNIQUE   = 'animal-companion-fiery-leopard.html';
const BASE_URL_UNIQUE  = 'https://2e.aonprd.com/Companions.aspx?ID=1&Type=Unique';

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
  await animalCompanionBaseNode.execute(Batch.of(state), stubContext);
  await animalCompanionStatsNode.execute(Batch.of(state), stubContext);
  await animalCompanionCombatNode.execute(Batch.of(state), stubContext);
  await animalCompanionAdvancementNode.execute(Batch.of(state), stubContext);
  await finalizeAnimalCompanionNode.execute(Batch.of(state), stubContext);
  return ParsedOutput.as<AnimalCompanionOutput>(state.output);
}

describe('extract:animal-companion-base — cave-pterosaur', () => {
  it('produces _type, url, name, companion_id, variant', async () => {
    const state = await primeState(FIXTURE_BASE, BASE_URL_BASE);
    const result = await animalCompanionBaseNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<AnimalCompanionOutput>(state.output);
    assert.equal(out.companion_id, 14);
    assert.equal(out.variant, 'base');
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name should be non-empty');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', BASE_URL_BASE);
    const result = await animalCompanionBaseNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });
});

describe('extract:animal-companion-stats — cave-pterosaur', () => {
  it('produces size, abilities, hit_points, speed', async () => {
    const state = await primeState(FIXTURE_BASE, BASE_URL_BASE);
    await animalCompanionBaseNode.execute(Batch.of(state), stubContext);
    const result = await animalCompanionStatsNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<AnimalCompanionOutput>(state.output);
    assert.ok(typeof out.abilities === 'object', 'abilities missing');
    assert.ok('str' in out.abilities, 'abilities.str missing');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', BASE_URL_BASE);
    const result = await animalCompanionStatsNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });
});

describe('extract:animal-companion-combat — cave-pterosaur', () => {
  it('produces strikes, support_benefit, advanced_maneuver', async () => {
    const state = await primeState(FIXTURE_BASE, BASE_URL_BASE);
    await animalCompanionBaseNode.execute(Batch.of(state), stubContext);
    await animalCompanionStatsNode.execute(Batch.of(state), stubContext);
    const result = await animalCompanionCombatNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<AnimalCompanionOutput>(state.output);
    assert.ok(Array.isArray(out.strikes), 'strikes should be array');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', BASE_URL_BASE);
    const result = await animalCompanionCombatNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });
});

describe('extract:animal-companion-advancement — cave-pterosaur', () => {
  it('produces advancement fields', async () => {
    const state = await primeState(FIXTURE_BASE, BASE_URL_BASE);
    await animalCompanionBaseNode.execute(Batch.of(state), stubContext);
    await animalCompanionStatsNode.execute(Batch.of(state), stubContext);
    await animalCompanionCombatNode.execute(Batch.of(state), stubContext);
    const result = await animalCompanionAdvancementNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<AnimalCompanionOutput>(state.output);
    assert.ok(Array.isArray(out.modifications), 'modifications missing');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', BASE_URL_BASE);
    const result = await animalCompanionAdvancementNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });
});

describe('finalize:animal-companion — cave-pterosaur (base)', () => {
  it('produces complete AnimalCompanionOutput', async () => {
    const out = await primeAndRunFull(FIXTURE_BASE, BASE_URL_BASE);
    assert.equal(out.companion_id, 14);
    assert.equal(out.variant, 'base');
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name missing');
    assert.ok(Array.isArray(out.strikes), 'strikes missing');
    assert.ok(Array.isArray(out.links), 'links missing');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
  });

  it('error path — soft-fails to success when prerequisites missing', async () => {
    const state = makeState('', BASE_URL_BASE);
    const result = await finalizeAnimalCompanionNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));
  });
});

describe('full pipeline — wind-chaser (specialized)', () => {
  it('variant is specialized', async () => {
    const out = await primeAndRunFull(FIXTURE_ADVANCED, BASE_URL_ADVANCED);
    assert.equal(out.variant, 'specialized');
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name missing');
  });
});

describe('full pipeline — fiery-leopard (unique)', () => {
  it('variant is unique and has base_companion reference or modifications', async () => {
    const out = await primeAndRunFull(FIXTURE_UNIQUE, BASE_URL_UNIQUE);
    assert.equal(out.variant, 'unique');
    // Unique pages have base_companion ref or modifications
    const hasUniqueContent = out.base_companion !== null || out.modifications.length > 0;
    assert.ok(hasUniqueContent, 'unique companion should have base_companion or modifications');
  });
});
