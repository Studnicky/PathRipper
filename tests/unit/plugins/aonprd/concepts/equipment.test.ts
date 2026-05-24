// Unit tests for equipment concept capability nodes (Phase 6.4).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { loadAndCommonNode }           from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import { sectionWalkerNode }           from '../../../../../plugins/aonprd/capabilities/sectionWalker.js';
import { labelPairBlockNode }          from '../../../../../plugins/aonprd/capabilities/labelPairBlock.js';
import { sourceRefNode }               from '../../../../../plugins/aonprd/capabilities/sourceRef.js';
import {
  equipmentBaseNode,
  equipmentMechanicsNode,
  finalizeEquipmentNode,
} from '../../../../../plugins/aonprd/concepts/equipment/index.js';
import type { EquipmentOutput } from '../../../../../plugins/aonprd/concepts/equipment/index.js';
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
  await equipmentBaseNode.execute(state, stubContext);
  await equipmentMechanicsNode.execute(state, stubContext);
  await finalizeEquipmentNode.execute(state, stubContext);
  return state.output as EquipmentOutput;
}

describe('extract:equipment-base — equipment-adventurers-pack', () => {
  it('produces _type, name, equipment_id', async () => {
    const state = await primeState('equipment-adventurers-pack.html', 'https://2e.aonprd.com/Equipment.aspx?ID=1');
    const r = await equipmentBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as EquipmentOutput;
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name should be non-empty');
    assert.equal(out.equipment_id, 1);
  });

  it('captures source and item_level', async () => {
    const state = await primeState('equipment-adventurers-pack.html', 'https://2e.aonprd.com/Equipment.aspx?ID=1');
    await equipmentBaseNode.execute(state, stubContext);
    const out = state.output as EquipmentOutput;
    assert.ok(out.source !== undefined, 'source missing');
    assert.ok('item_level' in out, 'item_level missing');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Equipment.aspx?ID=1');
    const r = await equipmentBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('extract:equipment-mechanics — equipment-adventurers-pack', () => {
  it('produces price, bulk, activations', async () => {
    const state = await primeState('equipment-adventurers-pack.html', 'https://2e.aonprd.com/Equipment.aspx?ID=1');
    await equipmentBaseNode.execute(state, stubContext);
    const r = await equipmentMechanicsNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as EquipmentOutput;
    assert.ok('price' in out, 'price missing');
    assert.ok('bulk' in out, 'bulk missing');
    assert.ok(Array.isArray(out.activations), 'activations should be array');
  });

  it('error path — returns error when prerequisites missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Equipment.aspx?ID=1');
    const r = await equipmentMechanicsNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('finalize:equipment — equipment-adventurers-pack', () => {
  it('produces raw_fields, variants, pfs_note', async () => {
    const state = await primeState('equipment-adventurers-pack.html', 'https://2e.aonprd.com/Equipment.aspx?ID=1');
    await equipmentBaseNode.execute(state, stubContext);
    await equipmentMechanicsNode.execute(state, stubContext);
    const r = await finalizeEquipmentNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as EquipmentOutput;
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
    assert.ok(Array.isArray((out as unknown as Record<string, unknown>)['variants']), 'variants missing');
    assert.ok('pfs_note' in out, 'pfs_note field missing');
  });

  it('error path — soft-fails to success when prerequisites missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Equipment.aspx?ID=1');
    const r = await finalizeEquipmentNode.execute(state, stubContext);
    assert.equal(r.output, 'success');
  });
});

describe('full equipment pipeline — equipment-adventurers-pack', () => {
  it('produces complete EquipmentOutput', async () => {
    const out = await primeAndRunFull('equipment-adventurers-pack.html', 'https://2e.aonprd.com/Equipment.aspx?ID=1');
    assert.equal(out.equipment_id, 1);
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name missing');
    assert.ok('price' in out, 'price missing');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
    assert.ok('pfs_note' in out, 'pfs_note field missing');
  });
});
