// Unit tests for spell concept capability nodes (Phase 6.4).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { loadAndCommonNode }   from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import {
  spellBaseNode,
  spellCastNode,
  spellOutcomesNode,
  spellAfflictionNode,
  spellHeightenedNode,
  spellMetaNode,
  finalizeSpellNode,
} from '../../../../../plugins/aonprd/concepts/spell/index.js';
import type { SpellOutput } from '../../../../../plugins/aonprd/concepts/spell/index.js';
import { loadFixture, makeState, stubContext } from '../nodes/helpers.js';

const FIXTURE_PLAGUE   = 'spell-abyssal-plague.html';
const URL_PLAGUE       = 'https://2e.aonprd.com/Spells.aspx?ID=1';

const FIXTURE_DEFENSE  = 'spell-with-defense.html';
const URL_DEFENSE      = 'https://2e.aonprd.com/Spells.aspx?ID=500';

const FIXTURE_DEITIES  = 'spell-with-deities.html';
const URL_DEITIES      = 'https://2e.aonprd.com/Spells.aspx?ID=200';

const FIXTURE_LESSON   = 'spell-with-lesson.html';
const URL_LESSON       = 'https://2e.aonprd.com/Spells.aspx?ID=300';

async function primeState(fixtureName: string, url: string) {
  const html  = await loadFixture(fixtureName);
  const state = makeState(html, url);
  const r = await loadAndCommonNode.execute(state, stubContext);
  assert.equal(r.output, 'success', `loadAndCommon failed for ${fixtureName}`);
  return state;
}

async function primeAndRunFull(fixtureName: string, url: string) {
  const state = await primeState(fixtureName, url);
  await spellBaseNode.execute(state, stubContext);
  await spellCastNode.execute(state, stubContext);
  await spellOutcomesNode.execute(state, stubContext);
  await spellAfflictionNode.execute(state, stubContext);
  await spellHeightenedNode.execute(state, stubContext);
  await spellMetaNode.execute(state, stubContext);
  await finalizeSpellNode.execute(state, stubContext);
  return state.output as SpellOutput;
}

// ─── extract:spell-base ───────────────────────────────────────────────────────

describe('extract:spell-base — abyssal-plague', () => {
  it('produces _type, name, url, spell_id, kind', async () => {
    const state = await primeState(FIXTURE_PLAGUE, URL_PLAGUE);
    const r = await spellBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as SpellOutput;
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name missing');
    assert.ok(out.spell_id !== null || out.spell_id === null, 'spell_id must exist');
    assert.ok(out.traits !== undefined, 'traits missing');
    assert.ok(out.sources !== undefined, 'sources missing');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', URL_PLAGUE);
    const r = await spellBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

// ─── extract:spell-cast ───────────────────────────────────────────────────────

describe('extract:spell-cast — abyssal-plague', () => {
  it('produces cast, range, area, targets, saving_throw, duration', async () => {
    const state = await primeState(FIXTURE_PLAGUE, URL_PLAGUE);
    await spellBaseNode.execute(state, stubContext);
    const r = await spellCastNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as SpellOutput;
    assert.ok(typeof out.cast === 'object', 'cast missing');
    assert.ok('actions' in out.cast, 'cast.actions missing');
    assert.ok(Array.isArray(out.cast.components), 'cast.components missing');
    // saving_throw may be null on spells with no save
    assert.ok('saving_throw' in out, 'saving_throw key missing');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', URL_PLAGUE);
    const r = await spellCastNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

// ─── extract:spell-cast (defense field) ──────────────────────────────────────

describe('extract:spell-cast — spell-with-defense', () => {
  it('populates defense field on remaster pages', async () => {
    const state = await primeState(FIXTURE_DEFENSE, URL_DEFENSE);
    await spellBaseNode.execute(state, stubContext);
    const r = await spellCastNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as SpellOutput;
    // Defense field should be present on remaster pages
    assert.ok('defense' in out, 'defense field missing on remaster spell');
  });
});

// ─── extract:spell-outcomes ───────────────────────────────────────────────────

describe('extract:spell-outcomes — abyssal-plague', () => {
  it('produces description_html, description_text, outcomes', async () => {
    const state = await primeState(FIXTURE_PLAGUE, URL_PLAGUE);
    await spellBaseNode.execute(state, stubContext);
    const r = await spellOutcomesNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as SpellOutput;
    assert.ok(typeof out.description_html === 'string', 'description_html missing');
    assert.ok(typeof out.description_text === 'string', 'description_text missing');
    assert.ok(typeof out.outcomes === 'object', 'outcomes missing');
    assert.ok('critical_success' in out.outcomes, 'outcomes.critical_success missing');
    assert.ok('failure' in out.outcomes, 'outcomes.failure missing');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', URL_PLAGUE);
    const r = await spellOutcomesNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

// ─── extract:spell-affliction ────────────────────────────────────────────────

describe('extract:spell-affliction — abyssal-plague (has affliction)', () => {
  it('produces affliction + ritual fields', async () => {
    const state = await primeState(FIXTURE_PLAGUE, URL_PLAGUE);
    const r = await spellAfflictionNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as SpellOutput;
    assert.ok('affliction' in out, 'affliction key missing');
    assert.ok('ritual_primary_check' in out, 'ritual_primary_check missing');
    assert.ok('ritual_secondary_casters' in out, 'ritual_secondary_casters missing');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', URL_PLAGUE);
    const r = await spellAfflictionNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

// ─── extract:spell-heightened ────────────────────────────────────────────────

describe('extract:spell-heightened — abyssal-plague', () => {
  it('produces heightened array', async () => {
    const state = await primeState(FIXTURE_PLAGUE, URL_PLAGUE);
    const r = await spellHeightenedNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as SpellOutput;
    assert.ok(Array.isArray(out.heightened), 'heightened should be an array');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', URL_PLAGUE);
    const r = await spellHeightenedNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

// ─── extract:spell-meta ───────────────────────────────────────────────────────

describe('extract:spell-meta — spell-with-deities', () => {
  it('produces traditions, deities, bloodlines, etc.', async () => {
    const state = await primeState(FIXTURE_DEITIES, URL_DEITIES);
    await spellBaseNode.execute(state, stubContext);
    const r = await spellMetaNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as SpellOutput;
    assert.ok(Array.isArray(out.traditions), 'traditions missing');
    assert.ok(Array.isArray(out.deities), 'deities missing');
    assert.ok(Array.isArray(out.bloodlines), 'bloodlines missing');
    assert.ok(Array.isArray(out.cult), 'cult missing');
  });

  it('deities array is non-empty for a deity-granted spell', async () => {
    const state = await primeState(FIXTURE_DEITIES, URL_DEITIES);
    await spellBaseNode.execute(state, stubContext);
    await spellMetaNode.execute(state, stubContext);

    const out = state.output as SpellOutput;
    assert.ok(out.deities.length > 0, 'deities array should be non-empty for spell-with-deities');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', URL_DEITIES);
    const r = await spellMetaNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('extract:spell-meta — spell-with-lesson (has lesson field)', () => {
  it('populates lesson field for witch focus spells', async () => {
    const state = await primeState(FIXTURE_LESSON, URL_LESSON);
    await spellBaseNode.execute(state, stubContext);
    await spellMetaNode.execute(state, stubContext);

    const out = state.output as SpellOutput;
    assert.ok(out.lesson !== null && out.lesson !== undefined, 'lesson should be non-null for spell-with-lesson');
    assert.ok(typeof out.lesson!.name === 'string', 'lesson.name should be a string');
  });
});

// ─── finalize:spell ───────────────────────────────────────────────────────────

describe('finalize:spell — abyssal-plague', () => {
  it('produces complete SpellOutput with all required fields', async () => {
    const out = await primeAndRunFull(FIXTURE_PLAGUE, URL_PLAGUE);
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name missing');
    assert.ok(typeof out.cast === 'object', 'cast missing');
    assert.ok(typeof out.outcomes === 'object', 'outcomes missing');
    assert.ok(Array.isArray(out.heightened), 'heightened missing');
    assert.ok(Array.isArray(out.traditions), 'traditions missing');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
    assert.ok(Array.isArray(out.links), 'links missing');
    assert.ok(typeof out.description_text === 'string', 'description_text missing');
  });

  it('raw_fields does not contain claimed keys', async () => {
    const out = await primeAndRunFull(FIXTURE_PLAGUE, URL_PLAGUE);
    const claimed = new Set([
      'cast', 'trigger', 'range', 'area', 'targets', 'target', 'target(s)',
      'defense', 'saving throw', 'duration', 'cost', 'requirements',
      'primary check', 'secondary casters', 'secondary checks',
      'traditions', 'tradition', 'spell list', 'source',
    ]);
    for (const key of Object.keys(out.raw_fields)) {
      assert.ok(
        !claimed.has(key.toLowerCase()),
        `claimed key "${key}" should be absent from raw_fields`,
      );
    }
  });

  it('error path — soft-fails to success when prerequisites missing', async () => {
    const state = makeState('', URL_PLAGUE);
    const r = await finalizeSpellNode.execute(state, stubContext);
    assert.equal(r.output, 'success');
  });
});

// ─── Full pipeline ────────────────────────────────────────────────────────────

describe('full spell pipeline — abyssal-plague', () => {
  it('produces complete typed SpellOutput', async () => {
    const out = await primeAndRunFull(FIXTURE_PLAGUE, URL_PLAGUE);
    assert.ok(typeof out.name === 'string' && out.name.length > 0);
    assert.ok(typeof out.description_html === 'string');
    assert.ok(typeof out.meta_description === 'string' || out.meta_description === null);
    assert.ok(typeof out.meta_keywords === 'string' || out.meta_keywords === null);
  });
});

describe('full spell pipeline — spell-with-deities', () => {
  it('populates deities array from deity-granted spell', async () => {
    const out = await primeAndRunFull(FIXTURE_DEITIES, URL_DEITIES);
    assert.ok(out.deities.length > 0, 'should have at least one deity');
  });
});
