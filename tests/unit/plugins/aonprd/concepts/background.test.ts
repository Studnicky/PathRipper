// Unit tests for background concept capability nodes (Phase 6.4).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { loadAndCommonNode }           from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import { sectionWalkerNode }           from '../../../../../plugins/aonprd/capabilities/sectionWalker.js';
import { labelPairBlockNode }          from '../../../../../plugins/aonprd/capabilities/labelPairBlock.js';
import { sourceRefNode }               from '../../../../../plugins/aonprd/capabilities/sourceRef.js';
import {
  backgroundBaseNode,
  backgroundBenefitsNode,
  finalizeBackgroundNode,
} from '../../../../../plugins/aonprd/concepts/background.js';
import type { BackgroundOutput } from '../../../../../plugins/aonprd/concepts/background.js';
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
  await backgroundBaseNode.execute(state, stubContext);
  await backgroundBenefitsNode.execute(state, stubContext);
  await finalizeBackgroundNode.execute(state, stubContext);
  return state.output as BackgroundOutput;
}

// ─── extract:background-base ──────────────────────────────────────────────────

describe('extract:background-base — background-acolyte', () => {
  it('produces _type, name, background_id', async () => {
    const state = await primeState('background-acolyte.html', 'https://2e.aonprd.com/Backgrounds.aspx?ID=1');
    const r = await backgroundBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as BackgroundOutput;
    assert.equal(out.name, 'Acolyte');
    assert.equal(out.background_id, 1);
  });

  it('source.book is populated', async () => {
    const state = await primeState('background-acolyte.html', 'https://2e.aonprd.com/Backgrounds.aspx?ID=1');
    await backgroundBaseNode.execute(state, stubContext);
    const out = state.output as BackgroundOutput;
    assert.ok(out.source.book !== null, 'source.book should be non-null');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Backgrounds.aspx?ID=1');
    const r = await backgroundBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

// ─── extract:background-benefits ─────────────────────────────────────────────

describe('extract:background-benefits — background-acolyte', () => {
  it('produces trained_skills and granted_feat arrays', async () => {
    const state = await primeState('background-acolyte.html', 'https://2e.aonprd.com/Backgrounds.aspx?ID=1');
    const r = await backgroundBenefitsNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as Partial<BackgroundOutput>;
    assert.ok(Array.isArray(out.trained_skills), 'trained_skills should be an array');
    assert.ok(Array.isArray(out.lore_skills), 'lore_skills should be an array');
  });

  it('granted_feat is non-null for Acolyte (grants Assurance or Deity\'s Domain)', async () => {
    const state = await primeState('background-acolyte.html', 'https://2e.aonprd.com/Backgrounds.aspx?ID=1');
    await backgroundBenefitsNode.execute(state, stubContext);
    const out = state.output as Partial<BackgroundOutput>;
    assert.ok(out.granted_feat !== null && out.granted_feat !== undefined, 'Acolyte should have a granted_feat');
  });

  it('error path — returns error when prerequisites missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Backgrounds.aspx?ID=1');
    const r = await backgroundBenefitsNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

// ─── finalize:background ──────────────────────────────────────────────────────

describe('finalize:background — background-acolyte', () => {
  it('produces raw_fields, links, body_text, sections, meta', async () => {
    const state = await primeState('background-acolyte.html', 'https://2e.aonprd.com/Backgrounds.aspx?ID=1');
    await backgroundBaseNode.execute(state, stubContext);
    await backgroundBenefitsNode.execute(state, stubContext);
    const r = await finalizeBackgroundNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as BackgroundOutput;
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
    assert.ok(Array.isArray(out.links), 'links missing');
    assert.ok(typeof out.body_text === 'string', 'body_text missing');
    assert.ok(Array.isArray(out.sections), 'sections missing');
  });

  it('error path — soft-fails to success when prerequisites missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Backgrounds.aspx?ID=1');
    const r = await finalizeBackgroundNode.execute(state, stubContext);
    assert.equal(r.output, 'success');
  });
});

// ─── Full pipeline ────────────────────────────────────────────────────────────

describe('full background pipeline — background-acolyte', () => {
  it('produces a complete BackgroundOutput with all required fields', async () => {
    const out = await primeAndRunFull('background-acolyte.html', 'https://2e.aonprd.com/Backgrounds.aspx?ID=1');

    assert.equal(out.name, 'Acolyte');
    assert.ok(Array.isArray(out.trained_skills), 'trained_skills missing');
    assert.ok(Array.isArray(out.lore_skills), 'lore_skills missing');
    assert.ok(typeof out.flavor_text === 'string', 'flavor_text missing');
    assert.ok(Array.isArray(out.sections), 'sections missing');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
    assert.ok(Array.isArray(out.links), 'links missing');
  });

  it('raw_fields does not contain "Source" or "Related Sources"', async () => {
    const out = await primeAndRunFull('background-acolyte.html', 'https://2e.aonprd.com/Backgrounds.aspx?ID=1');
    const claimed = new Set(['source', 'related sources', 'related source']);
    for (const key of Object.keys(out.raw_fields)) {
      assert.ok(!claimed.has(key.toLowerCase()), `claimed key "${key}" should be absent from raw_fields`);
    }
  });
});
