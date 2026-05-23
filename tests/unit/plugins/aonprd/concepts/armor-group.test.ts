// Unit tests for armor-group concept capability nodes (Phase 6.4).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { loadAndCommonNode }           from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import { sectionWalkerNode }           from '../../../../../plugins/aonprd/capabilities/sectionWalker.js';
import { labelPairBlockNode }          from '../../../../../plugins/aonprd/capabilities/labelPairBlock.js';
import { sourceRefNode }               from '../../../../../plugins/aonprd/capabilities/sourceRef.js';
import {
  armorGroupBaseNode,
  armorGroupContentNode,
  finalizeArmorGroupNode,
} from '../../../../../plugins/aonprd/concepts/armor-group.js';
import type { ArmorGroupOutput } from '../../../../../plugins/aonprd/concepts/armor-group.js';
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
  await armorGroupBaseNode.execute(state, stubContext);
  await armorGroupContentNode.execute(state, stubContext);
  await finalizeArmorGroupNode.execute(state, stubContext);
  return state.output as ArmorGroupOutput;
}

describe('extract:armor-group-base — armor-group-chain', () => {
  it('produces _type, name, group_id', async () => {
    const state = await primeState('armor-group-chain.html', 'https://2e.aonprd.com/ArmorGroups.aspx?ID=1');
    const r = await armorGroupBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as ArmorGroupOutput;
    assert.equal(out._type, 'armor-group');
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name should be non-empty');
    assert.equal(out.group_id, 1);
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/ArmorGroups.aspx?ID=1');
    const r = await armorGroupBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('extract:armor-group-content — armor-group-chain', () => {
  it('produces armor_specialization_html/text and armors[]', async () => {
    const state = await primeState('armor-group-chain.html', 'https://2e.aonprd.com/ArmorGroups.aspx?ID=1');
    await armorGroupBaseNode.execute(state, stubContext);
    const r = await armorGroupContentNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as ArmorGroupOutput;
    assert.ok(typeof out.armor_specialization_html === 'string', 'armor_specialization_html missing');
    assert.ok(typeof out.armor_specialization_text === 'string', 'armor_specialization_text missing');
    assert.ok(Array.isArray(out.armors), 'armors should be an array');
    assert.ok(out.armor_specialization_text.length > 0, 'armor_specialization_text should be non-empty');
  });

  it('error path — returns error when aonprdTarget missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/ArmorGroups.aspx?ID=1');
    const r = await armorGroupContentNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('full armor-group pipeline — armor-group-chain', () => {
  it('produces complete ArmorGroupOutput', async () => {
    const out = await primeAndRunFull('armor-group-chain.html', 'https://2e.aonprd.com/ArmorGroups.aspx?ID=1');
    assert.equal(out._type, 'armor-group');
    assert.equal(out.group_id, 1);
    assert.ok(out.armor_specialization_text.length > 0, 'armor_specialization_text should be non-empty');
    assert.ok(Array.isArray(out.armors), 'armors missing');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
  });
});

describe('full armor-group pipeline — armor-group-composite', () => {
  it('produces valid ArmorGroupOutput', async () => {
    const out = await primeAndRunFull('armor-group-composite.html', 'https://2e.aonprd.com/ArmorGroups.aspx?ID=2');
    assert.equal(out._type, 'armor-group');
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name missing');
  });
});
