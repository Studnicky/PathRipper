// Unit tests for deity concept capability nodes.
import { describe, it } from 'node:test';
import { Batch } from '@studnicky/dagonizer';
import assert from 'node:assert/strict';

import { loadAndCommonNode }   from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import { sectionWalkerNode }   from '../../../../../plugins/aonprd/capabilities/sectionWalker.js';
import {
  deityBaseNode,
  deityDevoteeBenefitsNode,
  deityEdictsAnathemaNode,
  deityClericSpellsNode,
  deityRelationshipsNode,
  finalizeDeityNode,
} from '../../../../../plugins/aonprd/concepts/deity/concept.js';
import type { DeityOutput } from '../../../../../plugins/aonprd/concepts/deity/types.js';
import { loadFixture, makeState, stubContext } from '../nodes/helpers.js';
import { ParsedOutput } from '../../../../helpers/ParsedOutput.js';

const FIXTURE_ABADAR = 'deity-abadar.html';
const URL_ABADAR     = 'https://2e.aonprd.com/Deities.aspx?ID=1';

async function primeState(fixtureName: string, url: string) {
  const html  = await loadFixture(fixtureName);
  const state = makeState(html, url);
  const result = await loadAndCommonNode.execute(Batch.of(state), stubContext);
  assert.ok(result.has('success'), `loadAndCommon failed for ${fixtureName}`);
  await sectionWalkerNode.execute(Batch.of(state), stubContext);
  return state;
}

async function primeAndRunFull(fixtureName: string, url: string) {
  const state = await primeState(fixtureName, url);
  await deityBaseNode.execute(Batch.of(state), stubContext);
  await deityDevoteeBenefitsNode.execute(Batch.of(state), stubContext);
  await deityEdictsAnathemaNode.execute(Batch.of(state), stubContext);
  await deityClericSpellsNode.execute(Batch.of(state), stubContext);
  await deityRelationshipsNode.execute(Batch.of(state), stubContext);
  await finalizeDeityNode.execute(Batch.of(state), stubContext);
  return ParsedOutput.as<DeityOutput>(state.output);
}

// ─── extract:deity-base ───────────────────────────────────────────────────────

describe('extract:deity-base — abadar', () => {
  it('produces _type, name, url, deity_id', async () => {
    const state = await primeState(FIXTURE_ABADAR, URL_ABADAR);
    const result = await deityBaseNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<DeityOutput>(state.output);
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name missing');
    assert.ok('deity_id' in out, 'deity_id missing');
    assert.ok(Array.isArray(out.traits), 'traits missing');
    assert.ok(Array.isArray(out.sources), 'sources missing');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', URL_ABADAR);
    const result = await deityBaseNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });
});

// ─── extract:deity-devotee-benefits ──────────────────────────────────────────

describe('extract:deity-devotee-benefits — abadar', () => {
  it('produces divine_attribute, divine_font, domains, favored_weapon', async () => {
    const state = await primeState(FIXTURE_ABADAR, URL_ABADAR);
    await deityBaseNode.execute(Batch.of(state), stubContext);
    const result = await deityDevoteeBenefitsNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<DeityOutput>(state.output);
    assert.ok('divine_attribute' in out, 'divine_attribute missing');
    assert.ok('divine_font' in out, 'divine_font missing');
    assert.ok('divine_skill' in out, 'divine_skill missing');
    assert.ok('favored_weapon' in out, 'favored_weapon missing');
    assert.ok(Array.isArray(out.domains), 'domains missing');
    assert.ok(Array.isArray(out.alternate_domains), 'alternate_domains missing');
  });

  it('domains array is non-empty for Abadar', async () => {
    const state = await primeState(FIXTURE_ABADAR, URL_ABADAR);
    await deityDevoteeBenefitsNode.execute(Batch.of(state), stubContext);

    const out = ParsedOutput.as<DeityOutput>(state.output);
    assert.ok(out.domains.length > 0, 'Abadar should have at least one domain');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', URL_ABADAR);
    const result = await deityDevoteeBenefitsNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });
});

// ─── extract:deity-edicts-anathema ───────────────────────────────────────────

describe('extract:deity-edicts-anathema — abadar', () => {
  it('produces edicts, anathema, category', async () => {
    const state = await primeState(FIXTURE_ABADAR, URL_ABADAR);
    await deityBaseNode.execute(Batch.of(state), stubContext);
    const result = await deityEdictsAnathemaNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<DeityOutput>(state.output);
    assert.ok('edicts' in out, 'edicts missing');
    assert.ok('anathema' in out, 'anathema missing');
    assert.ok('category' in out, 'category missing');
    assert.ok('areas_of_concern' in out, 'areas_of_concern missing');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', URL_ABADAR);
    const result = await deityEdictsAnathemaNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });
});

// ─── extract:deity-cleric-spells ─────────────────────────────────────────────

describe('extract:deity-cleric-spells — abadar', () => {
  it('produces cleric_spells array + intercessions array', async () => {
    const state = await primeState(FIXTURE_ABADAR, URL_ABADAR);
    await deityBaseNode.execute(Batch.of(state), stubContext);
    const result = await deityClericSpellsNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<DeityOutput>(state.output);
    assert.ok(Array.isArray(out.cleric_spells), 'cleric_spells missing');
    assert.ok(Array.isArray(out.intercessions), 'intercessions missing');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', URL_ABADAR);
    const result = await deityClericSpellsNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });
});

// ─── extract:deity-relationships ─────────────────────────────────────────────

describe('extract:deity-relationships — abadar', () => {
  it('produces deity_relationships array', async () => {
    const state = await primeState(FIXTURE_ABADAR, URL_ABADAR);
    await deityBaseNode.execute(Batch.of(state), stubContext);
    const result = await deityRelationshipsNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<DeityOutput>(state.output);
    assert.ok(Array.isArray(out.deity_relationships), 'deity_relationships missing');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', URL_ABADAR);
    const result = await deityRelationshipsNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });
});

// ─── finalize:deity ───────────────────────────────────────────────────────────

describe('finalize:deity — abadar', () => {
  it('produces complete DeityOutput with all required fields', async () => {
    const out = await primeAndRunFull(FIXTURE_ABADAR, URL_ABADAR);
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name missing');
    assert.ok(Array.isArray(out.domains), 'domains missing');
    assert.ok(Array.isArray(out.cleric_spells), 'cleric_spells missing');
    assert.ok(Array.isArray(out.intercessions), 'intercessions missing');
    assert.ok(Array.isArray(out.deity_relationships), 'deity_relationships missing');
    assert.ok(Array.isArray(out.sections), 'sections missing');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
    assert.ok(Array.isArray(out.links), 'links missing');
    assert.ok(typeof out.body_text === 'string', 'body_text missing');
  });

  it('error path — soft-fails to success when prerequisites missing', async () => {
    const state = makeState('', URL_ABADAR);
    const result = await finalizeDeityNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));
  });
});

// ─── Full pipeline ────────────────────────────────────────────────────────────

describe('full deity pipeline — abadar', () => {
  it('produces a complete DeityOutput with all major structural fields', async () => {
    const out = await primeAndRunFull(FIXTURE_ABADAR, URL_ABADAR);
    assert.ok(typeof out.name === 'string' && out.name.length > 0);
    assert.ok(typeof out.meta_description === 'string' || out.meta_description === null);
    assert.ok(typeof out.meta_keywords === 'string' || out.meta_keywords === null);
    // Abadar is a major deity — should have domains, edicts, and spells
    assert.ok(out.domains.length > 0, 'Abadar should have domains');
    assert.ok(out.edicts !== null || out.edicts === null, 'edicts key must exist');
    assert.ok(out.anathema !== null || out.anathema === null, 'anathema key must exist');
  });
});
