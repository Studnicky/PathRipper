// Unit tests for deity-category concept capability nodes (Phase 6.4).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { loadAndCommonNode }   from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import { sectionWalkerNode }   from '../../../../../plugins/aonprd/capabilities/sectionWalker.js';
import {
  deityCategoryBaseNode,
  deityCategoryMembersNode,
  deityCategoryAspectsNode,
  finalizeDeityCategoryNode,
} from '../../../../../plugins/aonprd/concepts/deity-category.js';
import type { DeityCategoryOutput } from '../../../../../plugins/aonprd/concepts/deity-category.js';
import { loadFixture, makeState, stubContext } from '../nodes/helpers.js';

const FIXTURE_INNER_SEA   = 'deity-category-gods-of-the-inner-sea.html';
const URL_INNER_SEA       = 'https://2e.aonprd.com/DeityCategories.aspx?ID=1';

const FIXTURE_EMPYREAL    = 'deity-category-empyreal-lords.html';
const URL_EMPYREAL        = 'https://2e.aonprd.com/DeityCategories.aspx?ID=2';

async function primeState(fixtureName: string, url: string) {
  const html  = await loadFixture(fixtureName);
  const state = makeState(html, url);
  const r = await loadAndCommonNode.execute(state, stubContext);
  assert.equal(r.output, 'success', `loadAndCommon failed for ${fixtureName}`);
  await sectionWalkerNode.execute(state, stubContext);
  return state;
}

async function primeAndRunFull(fixtureName: string, url: string) {
  const state = await primeState(fixtureName, url);
  await deityCategoryBaseNode.execute(state, stubContext);
  await deityCategoryMembersNode.execute(state, stubContext);
  await deityCategoryAspectsNode.execute(state, stubContext);
  await finalizeDeityCategoryNode.execute(state, stubContext);
  return state.output as DeityCategoryOutput;
}

// ─── extract:deity-category-base ─────────────────────────────────────────────

describe('extract:deity-category-base — gods-of-the-inner-sea', () => {
  it('produces _type, name, url, deity_category_id', async () => {
    const state = await primeState(FIXTURE_INNER_SEA, URL_INNER_SEA);
    const r = await deityCategoryBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as DeityCategoryOutput;
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name missing');
    assert.ok('deity_category_id' in out, 'deity_category_id missing');
    assert.ok(Array.isArray(out.traits), 'traits missing');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', URL_INNER_SEA);
    const r = await deityCategoryBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

// ─── extract:deity-category-members ──────────────────────────────────────────

describe('extract:deity-category-members — gods-of-the-inner-sea', () => {
  it('produces members array with linked deities', async () => {
    const state = await primeState(FIXTURE_INNER_SEA, URL_INNER_SEA);
    await deityCategoryBaseNode.execute(state, stubContext);
    const r = await deityCategoryMembersNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as DeityCategoryOutput;
    assert.ok(Array.isArray(out.members), 'members missing');
    assert.ok(out.members.length > 0, 'members should be non-empty for Gods of the Inner Sea');
  });

  it('member entries have name, deity_id, href', async () => {
    const state = await primeState(FIXTURE_INNER_SEA, URL_INNER_SEA);
    await deityCategoryMembersNode.execute(state, stubContext);

    const out = state.output as DeityCategoryOutput;
    const first = out.members[0];
    assert.ok(first !== undefined, 'no members found');
    assert.ok(typeof first.name === 'string' && first.name.length > 0, 'member.name missing');
    assert.ok(typeof first.href === 'string', 'member.href missing');
    // deity_id may be null for some entries
    assert.ok('deity_id' in first, 'member.deity_id missing');
  });

  it('error path — returns error when aonprdCheerio missing', async () => {
    const state = makeState('', URL_INNER_SEA);
    const r = await deityCategoryMembersNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

// ─── extract:deity-category-aspects ──────────────────────────────────────────

describe('extract:deity-category-aspects — gods-of-the-inner-sea', () => {
  it('produces aspects field (string or null)', async () => {
    const state = await primeState(FIXTURE_INNER_SEA, URL_INNER_SEA);
    await deityCategoryBaseNode.execute(state, stubContext);
    const r = await deityCategoryAspectsNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as DeityCategoryOutput;
    assert.ok('aspects' in out, 'aspects key missing');
    // Aspects is either a string or null — both are valid
    assert.ok(typeof out.aspects === 'string' || out.aspects === null, 'aspects must be string or null');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', URL_INNER_SEA);
    const r = await deityCategoryAspectsNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

// ─── finalize:deity-category ─────────────────────────────────────────────────

describe('finalize:deity-category — gods-of-the-inner-sea', () => {
  it('produces complete DeityCategoryOutput with all required fields', async () => {
    const out = await primeAndRunFull(FIXTURE_INNER_SEA, URL_INNER_SEA);
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name missing');
    assert.ok(Array.isArray(out.members), 'members missing');
    assert.ok('aspects' in out, 'aspects missing');
    assert.ok(Array.isArray(out.sections), 'sections missing');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
    assert.ok(Array.isArray(out.links), 'links missing');
    assert.ok(typeof out.body_text === 'string', 'body_text missing');
  });

  it('error path — soft-fails to success when prerequisites missing', async () => {
    const state = makeState('', URL_INNER_SEA);
    const r = await finalizeDeityCategoryNode.execute(state, stubContext);
    assert.equal(r.output, 'success');
  });
});

// ─── Full pipeline ────────────────────────────────────────────────────────────

describe('full deity-category pipeline — gods-of-the-inner-sea', () => {
  it('produces a complete DeityCategoryOutput', async () => {
    const out = await primeAndRunFull(FIXTURE_INNER_SEA, URL_INNER_SEA);
    assert.ok(typeof out.name === 'string' && out.name.length > 0);
    assert.ok(out.members.length > 0, 'members should be populated');
    assert.ok(typeof out.meta_description === 'string' || out.meta_description === null);
  });
});

describe('full deity-category pipeline — empyreal-lords', () => {
  it('produces a complete DeityCategoryOutput for a second fixture', async () => {
    const out = await primeAndRunFull(FIXTURE_EMPYREAL, URL_EMPYREAL);
    assert.ok(typeof out.name === 'string' && out.name.length > 0);
    assert.ok(Array.isArray(out.members), 'members should be an array');
  });
});
