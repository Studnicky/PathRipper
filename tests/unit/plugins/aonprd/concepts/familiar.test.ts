// Unit tests for familiar concept capability nodes.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { loadAndCommonNode }           from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import { sectionWalkerNode }           from '../../../../../plugins/aonprd/capabilities/sectionWalker.js';
import { labelPairBlockNode }          from '../../../../../plugins/aonprd/capabilities/labelPairBlock.js';
import { sourceRefNode }               from '../../../../../plugins/aonprd/capabilities/sourceRef.js';
import {
  familiarBaseNode,
  familiarPrerequisitesNode,
  finalizeFamiliarNode,
} from '../../../../../plugins/aonprd/concepts/familiar/index.js';
import type { FamiliarOutput } from '../../../../../plugins/aonprd/concepts/familiar/index.js';
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
  await familiarBaseNode.execute(state, stubContext);
  await familiarPrerequisitesNode.execute(state, stubContext);
  await finalizeFamiliarNode.execute(state, stubContext);
  return state.output as FamiliarOutput;
}

describe('extract:familiar-base — familiar-amphibious', () => {
  it('produces _type, name, familiar_id, familiar_kind', async () => {
    const state = await primeState('familiar-amphibious.html', 'https://2e.aonprd.com/Familiars.aspx?ID=1');
    const r = await familiarBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as FamiliarOutput;
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name should be non-empty');
    assert.equal(out.familiar_id, 1);
    assert.ok(out.familiar_kind === 'ability' || out.familiar_kind === 'specific', 'familiar_kind should be ability or specific');
  });

  it('familiar-kind is "ability" for standard ability pages', async () => {
    const state = await primeState('familiar-amphibious.html', 'https://2e.aonprd.com/Familiars.aspx?ID=1');
    await familiarBaseNode.execute(state, stubContext);
    const out = state.output as FamiliarOutput;
    assert.equal(out.familiar_kind, 'ability', 'amphibious should be an ability page');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Familiars.aspx?ID=1');
    const r = await familiarBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('extract:familiar-prerequisites — familiar-amphibious', () => {
  it('produces ability_type, granted_abilities, required_number_of_abilities', async () => {
    const state = await primeState('familiar-amphibious.html', 'https://2e.aonprd.com/Familiars.aspx?ID=1');
    await familiarBaseNode.execute(state, stubContext);
    const r = await familiarPrerequisitesNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as FamiliarOutput;
    assert.ok('ability_type' in out, 'ability_type missing');
    assert.ok(Array.isArray(out.granted_abilities), 'granted_abilities should be array');
    assert.ok('required_number_of_abilities' in out, 'required_number_of_abilities missing');
  });

  it('error path — returns error when prerequisites missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Familiars.aspx?ID=1');
    const r = await familiarPrerequisitesNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('finalize:familiar — familiar-amphibious', () => {
  it('produces abilities, sections, raw_fields, body fields', async () => {
    const state = await primeState('familiar-amphibious.html', 'https://2e.aonprd.com/Familiars.aspx?ID=1');
    await familiarBaseNode.execute(state, stubContext);
    await familiarPrerequisitesNode.execute(state, stubContext);
    const r = await finalizeFamiliarNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as FamiliarOutput;
    assert.ok(Array.isArray(out.abilities), 'abilities missing');
    assert.ok(Array.isArray(out.sections), 'sections missing');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
    assert.ok(typeof out.body_text === 'string', 'body_text missing');
  });

  it('error path — soft-fails to success when prerequisites missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Familiars.aspx?ID=1');
    const r = await finalizeFamiliarNode.execute(state, stubContext);
    assert.equal(r.output, 'success');
  });
});

describe('full familiar pipeline — familiar-ceru (specific familiar)', () => {
  it('produces complete FamiliarOutput for specific familiar', async () => {
    const out = await primeAndRunFull('familiar-ceru.html', 'https://2e.aonprd.com/Familiars.aspx?ID=1&Specific=true');
    assert.equal(out.familiar_kind, 'specific', 'ceru should be specific familiar');
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name missing');
    assert.ok(Array.isArray(out.abilities), 'abilities missing');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
  });
});

describe('full familiar pipeline — familiar-amphibious (ability)', () => {
  it('produces complete FamiliarOutput for ability', async () => {
    const out = await primeAndRunFull('familiar-amphibious.html', 'https://2e.aonprd.com/Familiars.aspx?ID=1');
    assert.equal(out.familiar_kind, 'ability');
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name missing');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
  });
});
