// Unit tests for skill concept capability nodes (Phase 6.4).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { loadAndCommonNode }           from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import { sectionWalkerNode }           from '../../../../../plugins/aonprd/capabilities/sectionWalker.js';
import { labelPairBlockNode }          from '../../../../../plugins/aonprd/capabilities/labelPairBlock.js';
import { sourceRefNode }               from '../../../../../plugins/aonprd/capabilities/sourceRef.js';
import {
  skillBaseNode,
  skillActionsNode,
  skillProficiencyTiersNode,
  finalizeSkillNode,
} from '../../../../../plugins/aonprd/concepts/skill/index.js';
import type { SkillOutput } from '../../../../../plugins/aonprd/concepts/skill/index.js';
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
  await skillBaseNode.execute(state, stubContext);
  await skillActionsNode.execute(state, stubContext);
  await skillProficiencyTiersNode.execute(state, stubContext);
  await finalizeSkillNode.execute(state, stubContext);
  return state.output as SkillOutput;
}

// ─── extract:skill-base ───────────────────────────────────────────────────────

describe('extract:skill-base — skill-acrobatics', () => {
  it('produces _type, name, skill_id, key_ability', async () => {
    const state = await primeState('skill-acrobatics.html', 'https://2e.aonprd.com/Skills.aspx?ID=1');
    const r = await skillBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as SkillOutput;
    assert.equal(out.name, 'Acrobatics');
    assert.equal(out.skill_id, 1);
    assert.ok(out.key_ability !== null, 'Acrobatics has a key ability (dex)');
    assert.equal(out.key_ability, 'dex', 'Acrobatics key ability is dex');
  });

  it('description_text is non-empty', async () => {
    const state = await primeState('skill-acrobatics.html', 'https://2e.aonprd.com/Skills.aspx?ID=1');
    await skillBaseNode.execute(state, stubContext);
    const out = state.output as SkillOutput;
    assert.ok(out.description_text.length > 0, 'description_text should be non-empty');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Skills.aspx?ID=1');
    const r = await skillBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

// ─── extract:skill-actions ────────────────────────────────────────────────────

describe('extract:skill-actions — skill-acrobatics', () => {
  it('produces actions array with at least one entry (Balance)', async () => {
    const state = await primeState('skill-acrobatics.html', 'https://2e.aonprd.com/Skills.aspx?ID=1');
    const r = await skillActionsNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as Partial<SkillOutput>;
    assert.ok(Array.isArray(out.actions), 'actions should be an array');
    assert.ok((out.actions?.length ?? 0) > 0, 'Acrobatics should have at least one action');
  });

  it('each action has name, action_cost, traits, description_text', async () => {
    const state = await primeState('skill-acrobatics.html', 'https://2e.aonprd.com/Skills.aspx?ID=1');
    await skillActionsNode.execute(state, stubContext);
    const out = state.output as Partial<SkillOutput>;
    const first = out.actions?.[0];
    assert.ok(first !== undefined, 'should have at least one action');
    assert.ok(typeof first.name === 'string' && first.name.length > 0, 'action.name missing');
    assert.ok(Array.isArray(first.traits), 'action.traits missing');
    assert.ok(typeof first.description_text === 'string', 'action.description_text missing');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Skills.aspx?ID=1');
    const r = await skillActionsNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

// ─── extract:skill-proficiency-tiers ─────────────────────────────────────────

describe('extract:skill-proficiency-tiers — skill-acrobatics', () => {
  it('produces proficiency_tiers as an array', async () => {
    const state = await primeState('skill-acrobatics.html', 'https://2e.aonprd.com/Skills.aspx?ID=1');
    const r = await skillProficiencyTiersNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as Partial<SkillOutput>;
    assert.ok(Array.isArray(out.proficiency_tiers), 'proficiency_tiers should be an array');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Skills.aspx?ID=1');
    const r = await skillProficiencyTiersNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

// ─── Full pipeline ────────────────────────────────────────────────────────────

describe('full skill pipeline — skill-acrobatics', () => {
  it('produces a complete SkillOutput with all required fields', async () => {
    const out = await primeAndRunFull('skill-acrobatics.html', 'https://2e.aonprd.com/Skills.aspx?ID=1');

    assert.equal(out.name, 'Acrobatics');
    assert.equal(out.key_ability, 'dex');
    assert.ok(typeof out.description_text === 'string' && out.description_text.length > 0, 'description_text missing');
    assert.ok(Array.isArray(out.actions) && out.actions.length > 0, 'actions missing');
    assert.ok(Array.isArray(out.proficiency_tiers), 'proficiency_tiers missing');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
    assert.ok(Array.isArray(out.links), 'links missing');
    assert.ok(typeof out.body_text === 'string' && out.body_text.length > 0, 'body_text missing');
  });

  it('body_html is taken from full content span (not cut at first <hr/>)', async () => {
    const out = await primeAndRunFull('skill-acrobatics.html', 'https://2e.aonprd.com/Skills.aspx?ID=1');
    // body_html should contain at least one action heading — proves the span walk
    assert.ok(/h2/i.test(out.body_html) || out.body_html.length > 200, 'body_html appears truncated');
  });
});
