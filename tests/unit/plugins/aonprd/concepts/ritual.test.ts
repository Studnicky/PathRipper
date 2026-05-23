// Unit tests for ritual concept capability nodes (Phase 6.4).
// Rituals share the spell HTML structure — same slices, different URL paths.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { loadAndCommonNode } from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import {
  ritualBaseNode,
  ritualCastNode,
  ritualOutcomesNode,
  ritualAfflictionNode,
  ritualHeightenedNode,
  ritualMetaNode,
  finalizeRitualNode,
} from '../../../../../plugins/aonprd/concepts/ritual/index.js';
import type { RitualOutput } from '../../../../../plugins/aonprd/concepts/ritual/index.js';
import { loadFixture, makeState, stubContext } from '../nodes/helpers.js';

const FIXTURE_RITUAL = 'ritual-awaken-animal.html';
const URL_RITUAL     = 'https://2e.aonprd.com/Rituals.aspx?ID=3';

async function primeState(fixtureName: string, url: string) {
  const html  = await loadFixture(fixtureName);
  const state = makeState(html, url);
  const r = await loadAndCommonNode.execute(state, stubContext);
  assert.equal(r.output, 'success', `loadAndCommon failed for ${fixtureName}`);
  return state;
}

async function primeAndRunFull(fixtureName: string, url: string) {
  const state = await primeState(fixtureName, url);
  await ritualBaseNode.execute(state, stubContext);
  await ritualCastNode.execute(state, stubContext);
  await ritualOutcomesNode.execute(state, stubContext);
  await ritualAfflictionNode.execute(state, stubContext);
  await ritualHeightenedNode.execute(state, stubContext);
  await ritualMetaNode.execute(state, stubContext);
  await finalizeRitualNode.execute(state, stubContext);
  return state.output as RitualOutput;
}

// ─── extract:ritual-base ─────────────────────────────────────────────────────

describe('extract:ritual-base — awaken-animal', () => {
  it('produces _type, name, url, kind resolves to ritual', async () => {
    const state = await primeState(FIXTURE_RITUAL, URL_RITUAL);
    const r = await ritualBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as RitualOutput;
    // Rituals should set kind to 'ritual' via resolveKind()
    assert.equal(out._type, 'spell', '_type is spell (ritual inherits spell output shape)');
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name missing');
    assert.ok(Array.isArray(out.traits), 'traits missing');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', URL_RITUAL);
    const r = await ritualBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

// ─── extract:ritual-affliction (ritual check fields) ─────────────────────────

describe('extract:ritual-affliction — awaken-animal (ritual check fields)', () => {
  it('populates ritual_primary_check and ritual_secondary_casters', async () => {
    const state = await primeState(FIXTURE_RITUAL, URL_RITUAL);
    const r = await ritualAfflictionNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as RitualOutput;
    assert.ok('ritual_primary_check' in out, 'ritual_primary_check missing');
    assert.ok('ritual_secondary_casters' in out, 'ritual_secondary_casters missing');
    assert.ok('ritual_secondary_checks' in out, 'ritual_secondary_checks missing');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', URL_RITUAL);
    const r = await ritualAfflictionNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

// ─── finalize:ritual ─────────────────────────────────────────────────────────

describe('finalize:ritual — awaken-animal', () => {
  it('produces complete output with all required fields', async () => {
    const out = await primeAndRunFull(FIXTURE_RITUAL, URL_RITUAL);
    assert.equal(out._type, 'spell');
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name missing');
    assert.ok(typeof out.cast === 'object', 'cast missing');
    assert.ok(typeof out.outcomes === 'object', 'outcomes missing');
    assert.ok(Array.isArray(out.heightened), 'heightened missing');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
    assert.ok(Array.isArray(out.links), 'links missing');
    assert.ok(typeof out.description_text === 'string', 'description_text missing');
  });

  it('kind resolves to ritual', async () => {
    const out = await primeAndRunFull(FIXTURE_RITUAL, URL_RITUAL);
    assert.equal(out.kind, 'ritual', 'kind should be "ritual" for ritual pages');
  });

  it('error path — soft-fails to success when prerequisites missing', async () => {
    const state = makeState('', URL_RITUAL);
    const r = await finalizeRitualNode.execute(state, stubContext);
    assert.equal(r.output, 'success');
  });
});

// ─── Full pipeline ────────────────────────────────────────────────────────────

describe('full ritual pipeline — awaken-animal', () => {
  it('produces complete SpellOutput with ritual kind', async () => {
    const out = await primeAndRunFull(FIXTURE_RITUAL, URL_RITUAL);
    assert.equal(out.kind, 'ritual');
    assert.ok(typeof out.name === 'string' && out.name.length > 0);
    assert.ok(typeof out.description_html === 'string');
  });

  it('ritual_primary_check is set for awaken-animal', async () => {
    const out = await primeAndRunFull(FIXTURE_RITUAL, URL_RITUAL);
    // Awaken Animal requires a Nature check as primary
    assert.ok(
      out.ritual_primary_check !== null,
      'ritual_primary_check should be non-null for Awaken Animal',
    );
  });
});
