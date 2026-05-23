// Unit tests for action concept capability nodes (Phase 6.4).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { loadAndCommonNode }           from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import { sectionWalkerNode }           from '../../../../../plugins/aonprd/capabilities/sectionWalker.js';
import { labelPairBlockNode }          from '../../../../../plugins/aonprd/capabilities/labelPairBlock.js';
import { sourceRefNode }               from '../../../../../plugins/aonprd/capabilities/sourceRef.js';
import {
  actionBaseNode,
  actionEffectNode,
  finalizeActionNode,
} from '../../../../../plugins/aonprd/concepts/action.js';
import type { ActionOutput } from '../../../../../plugins/aonprd/concepts/action.js';
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
  await actionBaseNode.execute(state, stubContext);
  await actionEffectNode.execute(state, stubContext);
  await finalizeActionNode.execute(state, stubContext);
  return state.output as ActionOutput;
}

describe('extract:action-base — action-hunt-prey', () => {
  it('produces _type, name, action_id', async () => {
    const state = await primeState('action-hunt-prey.html', 'https://2e.aonprd.com/Actions.aspx?ID=1');
    const r = await actionBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as ActionOutput;
    assert.equal(out._type, 'action');
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name should be non-empty');
    assert.equal(out.action_id, 1);
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Actions.aspx?ID=1');
    const r = await actionBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('extract:action-effect — action-hunt-prey', () => {
  it('produces effect_html, effect_text, and outcomes', async () => {
    const state = await primeState('action-hunt-prey.html', 'https://2e.aonprd.com/Actions.aspx?ID=1');
    await actionBaseNode.execute(state, stubContext);
    const r = await actionEffectNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as ActionOutput;
    assert.ok(typeof out.effect_html === 'string', 'effect_html missing');
    assert.ok(typeof out.effect_text === 'string', 'effect_text missing');
    assert.ok(typeof out.outcomes === 'object', 'outcomes missing');
    assert.ok('critical_success' in out.outcomes, 'outcomes.critical_success missing');
    assert.ok('critical_failure' in out.outcomes, 'outcomes.critical_failure missing');
  });

  it('error path — returns error when prerequisites missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Actions.aspx?ID=1');
    const r = await actionEffectNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('finalize:action — action-with-skill', () => {
  it('extracts skill field when present', async () => {
    const state = await primeState('action-with-skill.html', 'https://2e.aonprd.com/Actions.aspx?ID=2');
    await actionBaseNode.execute(state, stubContext);
    await actionEffectNode.execute(state, stubContext);
    const r = await finalizeActionNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as ActionOutput;
    assert.ok(out.skill !== null, 'skill should be non-null for action-with-skill fixture');
    assert.ok(typeof out.skill!.name === 'string' && out.skill!.name.length > 0, 'skill.name missing');
  });
});

describe('full action pipeline — action-hunt-prey', () => {
  it('produces complete ActionOutput with all required fields', async () => {
    const out = await primeAndRunFull('action-hunt-prey.html', 'https://2e.aonprd.com/Actions.aspx?ID=1');
    assert.equal(out._type, 'action');
    assert.equal(out.action_id, 1);
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name missing');
    assert.ok(typeof out.effect_text === 'string', 'effect_text missing');
    assert.ok(typeof out.outcomes === 'object', 'outcomes missing');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
    assert.ok(Array.isArray(out.links), 'links missing');
  });
});
