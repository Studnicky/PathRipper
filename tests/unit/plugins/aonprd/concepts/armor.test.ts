// Unit tests for armor concept capability nodes.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { loadAndCommonNode }           from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import { sectionWalkerNode }           from '../../../../../plugins/aonprd/capabilities/sectionWalker.js';
import { labelPairBlockNode }          from '../../../../../plugins/aonprd/capabilities/labelPairBlock.js';
import { sourceRefNode }               from '../../../../../plugins/aonprd/capabilities/sourceRef.js';
import {
  armorBaseNode,
  armorMechanicsNode,
  finalizeArmorNode,
} from '../../../../../plugins/aonprd/concepts/armor/index.js';
import type { ArmorOutput } from '../../../../../plugins/aonprd/concepts/armor/index.js';
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
  await armorBaseNode.execute(state, stubContext);
  await armorMechanicsNode.execute(state, stubContext);
  await finalizeArmorNode.execute(state, stubContext);
  return state.output as ArmorOutput;
}

describe('extract:armor-base — armor-leather', () => {
  it('produces _type, name, armor_id', async () => {
    const state = await primeState('armor-leather.html', 'https://2e.aonprd.com/Armor.aspx?ID=4');
    const r = await armorBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as ArmorOutput;
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name should be non-empty');
    assert.equal(out.armor_id, 4);
  });

  it('captures source', async () => {
    const state = await primeState('armor-leather.html', 'https://2e.aonprd.com/Armor.aspx?ID=4');
    await armorBaseNode.execute(state, stubContext);
    const out = state.output as ArmorOutput;
    assert.ok(out.source !== undefined, 'source missing');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Armor.aspx?ID=4');
    const r = await armorBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('extract:armor-mechanics — armor-leather', () => {
  it('produces price, ac_bonus, bulk, category, group', async () => {
    const state = await primeState('armor-leather.html', 'https://2e.aonprd.com/Armor.aspx?ID=4');
    await armorBaseNode.execute(state, stubContext);
    const r = await armorMechanicsNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as ArmorOutput;
    assert.ok('price' in out, 'price missing');
    assert.ok('ac_bonus' in out, 'ac_bonus missing');
    assert.ok('bulk' in out, 'bulk missing');
    assert.ok('category' in out, 'category missing');
    assert.ok('group' in out, 'group missing');
  });

  it('category is "light" for leather armor', async () => {
    const state = await primeState('armor-leather.html', 'https://2e.aonprd.com/Armor.aspx?ID=4');
    await armorBaseNode.execute(state, stubContext);
    await armorMechanicsNode.execute(state, stubContext);
    const out = state.output as ArmorOutput;
    assert.equal(out.category, 'light', 'leather should be light armor');
  });

  it('error path — returns error when prerequisites missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Armor.aspx?ID=4');
    const r = await armorMechanicsNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('finalize:armor — armor-leather', () => {
  it('produces raw_fields, links, meta fields', async () => {
    const state = await primeState('armor-leather.html', 'https://2e.aonprd.com/Armor.aspx?ID=4');
    await armorBaseNode.execute(state, stubContext);
    await armorMechanicsNode.execute(state, stubContext);
    const r = await finalizeArmorNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as ArmorOutput;
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
    assert.ok(Array.isArray(out.links), 'links missing');
    assert.ok('meta_description' in out, 'meta_description missing');
    assert.ok('meta_keywords' in out, 'meta_keywords missing');
  });

  it('error path — soft-fails to success when prerequisites missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Armor.aspx?ID=4');
    const r = await finalizeArmorNode.execute(state, stubContext);
    assert.equal(r.output, 'success');
  });
});

describe('full armor pipeline — armor-leather', () => {
  it('produces complete ArmorOutput', async () => {
    const out = await primeAndRunFull('armor-leather.html', 'https://2e.aonprd.com/Armor.aspx?ID=4');
    assert.equal(out.armor_id, 4);
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name missing');
    assert.ok('ac_bonus' in out, 'ac_bonus missing');
    assert.ok('category' in out, 'category missing');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
  });
});
