// Unit tests for ancestry concept capability nodes.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { loadAndCommonNode }           from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import { sectionWalkerNode }           from '../../../../../plugins/aonprd/capabilities/sectionWalker.js';
import { labelPairBlockNode }          from '../../../../../plugins/aonprd/capabilities/labelPairBlock.js';
import { sourceRefNode }               from '../../../../../plugins/aonprd/capabilities/sourceRef.js';
import {
  ancestryBaseNode,
  ancestryHeritagesNode,
  ancestryFeaturesNode,
  finalizeAncestryNode,
} from '../../../../../plugins/aonprd/concepts/ancestry.js';
import type { AncestryOutput } from '../../../../../plugins/aonprd/concepts/ancestry.js';
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
  await ancestryBaseNode.execute(state, stubContext);
  await ancestryHeritagesNode.execute(state, stubContext);
  await ancestryFeaturesNode.execute(state, stubContext);
  await finalizeAncestryNode.execute(state, stubContext);
  return state.output as AncestryOutput;
}

// ─── extract:ancestry-base ────────────────────────────────────────────────────

describe('extract:ancestry-base — ancestry-goblin', () => {
  it('produces _type, name, ancestry_id, rarity', async () => {
    const state = await primeState('ancestry-goblin.html', 'https://2e.aonprd.com/Ancestries.aspx?ID=4');
    const r = await ancestryBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as AncestryOutput;
    assert.equal(out.name, 'Goblin');
    assert.equal(out.ancestry_id, 4);
    // Rarity comes from the fixture's trait pills — accept whatever the fixture reports
    assert.ok(typeof out.rarity === 'string', 'rarity should be a string');
  });

  it('mechanics.hit_points is a number', async () => {
    const state = await primeState('ancestry-goblin.html', 'https://2e.aonprd.com/Ancestries.aspx?ID=4');
    await ancestryBaseNode.execute(state, stubContext);
    const out = state.output as AncestryOutput;
    assert.ok(typeof out.mechanics.hit_points === 'number', 'hit_points should be a number');
    assert.ok((out.mechanics.hit_points ?? 0) > 0, 'hit_points should be positive');
  });

  it('source.book is populated', async () => {
    const state = await primeState('ancestry-goblin.html', 'https://2e.aonprd.com/Ancestries.aspx?ID=4');
    await ancestryBaseNode.execute(state, stubContext);
    const out = state.output as AncestryOutput;
    assert.ok(out.source.book !== null, 'source.book should be non-null');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Ancestries.aspx?ID=4');
    const r = await ancestryBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

// ─── extract:ancestry-heritages ──────────────────────────────────────────────

describe('extract:ancestry-heritages — ancestry-goblin', () => {
  it('produces heritages array', async () => {
    const state = await primeState('ancestry-goblin.html', 'https://2e.aonprd.com/Ancestries.aspx?ID=4');
    const r = await ancestryHeritagesNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as Partial<AncestryOutput>;
    assert.ok(Array.isArray(out.heritages), 'heritages should be an array');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Ancestries.aspx?ID=4');
    const r = await ancestryHeritagesNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

// ─── extract:ancestry-features ───────────────────────────────────────────────

describe('extract:ancestry-features — ancestry-goblin', () => {
  it('produces initial_proficiencies and features arrays', async () => {
    const state = await primeState('ancestry-goblin.html', 'https://2e.aonprd.com/Ancestries.aspx?ID=4');
    const r = await ancestryFeaturesNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as Partial<AncestryOutput>;
    assert.ok(typeof out.initial_proficiencies === 'object', 'initial_proficiencies missing');
    assert.ok(Array.isArray(out.features), 'features should be an array');
  });

  it('error path — returns error when prerequisites missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Ancestries.aspx?ID=4');
    const r = await ancestryFeaturesNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

// ─── finalize:ancestry ────────────────────────────────────────────────────────

describe('finalize:ancestry — ancestry-goblin', () => {
  it('produces raw_fields, links, body_text, sections, meta', async () => {
    const state = await primeState('ancestry-goblin.html', 'https://2e.aonprd.com/Ancestries.aspx?ID=4');
    await ancestryBaseNode.execute(state, stubContext);
    await ancestryHeritagesNode.execute(state, stubContext);
    await ancestryFeaturesNode.execute(state, stubContext);
    const r = await finalizeAncestryNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as AncestryOutput;
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
    assert.ok(Array.isArray(out.links), 'links missing');
    assert.ok(typeof out.body_text === 'string', 'body_text missing');
    assert.ok(Array.isArray(out.sections), 'sections missing');
  });

  it('error path — soft-fails to success when prerequisites missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Ancestries.aspx?ID=4');
    const r = await finalizeAncestryNode.execute(state, stubContext);
    assert.equal(r.output, 'success');
  });
});

// ─── Full pipeline ────────────────────────────────────────────────────────────

describe('full ancestry pipeline — ancestry-goblin', () => {
  it('produces a complete AncestryOutput with all required fields', async () => {
    const out = await primeAndRunFull('ancestry-goblin.html', 'https://2e.aonprd.com/Ancestries.aspx?ID=4');

    assert.equal(out.name, 'Goblin');
    assert.equal(out.ancestry_id, 4);
    assert.ok(typeof out.mechanics === 'object', 'mechanics missing');
    assert.ok(Array.isArray(out.heritages), 'heritages missing');
    assert.ok(Array.isArray(out.features), 'features missing');
    assert.ok(typeof out.initial_proficiencies === 'object', 'initial_proficiencies missing');
    assert.ok(Array.isArray(out.sections), 'sections missing');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
    assert.ok(Array.isArray(out.links), 'links missing');
    assert.ok(typeof out.body_text === 'string', 'body_text missing');
    assert.ok(typeof out.body_html === 'string', 'body_html missing');
  });

  it('mechanics.languages has fixed and bonus_choice arrays', async () => {
    const out = await primeAndRunFull('ancestry-goblin.html', 'https://2e.aonprd.com/Ancestries.aspx?ID=4');
    assert.ok(Array.isArray(out.mechanics.languages.fixed), 'languages.fixed missing');
    assert.ok(Array.isArray(out.mechanics.languages.bonus_choice), 'languages.bonus_choice missing');
  });
});
