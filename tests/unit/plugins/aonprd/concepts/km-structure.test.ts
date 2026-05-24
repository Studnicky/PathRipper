// Unit tests for km-structure concept capability nodes.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { loadAndCommonNode }         from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import {
  kmStructureBaseNode,
  kmStructureMechanicsNode,
  finalizeKmStructureNode,
} from '../../../../../plugins/aonprd/concepts/km-structure.js';
import type { KmStructureOutput } from '../../../../../plugins/aonprd/concepts/km-structure.js';
import { loadFixture, makeState, stubContext } from '../nodes/helpers.js';

const FIXTURE = 'km-structure-academy.html';
const URL     = 'https://2e.aonprd.com/KMStructures.aspx?ID=1';

async function primeState() {
  const html  = await loadFixture(FIXTURE);
  const state = makeState(html, URL);
  await loadAndCommonNode.execute(state, stubContext);
  return state;
}

async function primeAndRunFull() {
  const state = await primeState();
  await kmStructureBaseNode.execute(state, stubContext);
  await kmStructureMechanicsNode.execute(state, stubContext);
  await finalizeKmStructureNode.execute(state, stubContext);
  return state.output as KmStructureOutput;
}

describe('extract:km-structure-base — km-structure-academy', () => {
  it('produces _type, name, structure_id', async () => {
    const state = await primeState();
    const r = await kmStructureBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as KmStructureOutput;
    assert.equal(out.name, 'Academy');
    assert.equal(out.structure_id, 1);
    assert.ok(Array.isArray(out.traits), 'traits is array');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', URL);
    const r = await kmStructureBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('extract:km-structure-mechanics — km-structure-academy', () => {
  it('produces lots, cost_raw, and upgrade fields', async () => {
    const state = await primeState();
    await kmStructureBaseNode.execute(state, stubContext);
    const r = await kmStructureMechanicsNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as KmStructureOutput;
    // Academy should have Lots defined
    assert.ok('lots' in out, 'lots field present');
    assert.ok('cost_raw' in out, 'cost_raw field present');
    assert.ok(Array.isArray(out.cost), 'cost is array');
    assert.ok('upgrade_from' in out, 'upgrade_from present');
    assert.ok('upgrade_to' in out, 'upgrade_to present');
    assert.ok(Array.isArray(out.item_bonuses), 'item_bonuses is array');
    assert.ok('description' in out, 'description present');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', URL);
    const r = await kmStructureMechanicsNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('finalize:km-structure — km-structure-academy', () => {
  it('assembles complete KmStructureOutput with all required fields', async () => {
    const out = await primeAndRunFull();
    assert.equal(out.name, 'Academy');
    assert.equal(out.structure_id, 1);
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields present');
    assert.ok(typeof out.body_html === 'string', 'body_html present');
    assert.ok(Array.isArray(out.links), 'links present');
    assert.ok('meta_description' in out, 'meta_description present');
    assert.ok('meta_keywords' in out, 'meta_keywords present');
    assert.ok(Array.isArray(out.sections), 'sections present');
  });

  it('strips claimed AON labels from raw_fields', async () => {
    const out = await primeAndRunFull();
    assert.equal(out.raw_fields['Source'], undefined, 'Source stripped');
    assert.equal(out.raw_fields['Lots'], undefined, 'Lots stripped');
    assert.equal(out.raw_fields['Cost'], undefined, 'Cost stripped');
  });

  it('error path — soft-fails to success when prerequisites missing', async () => {
    const state = makeState('', URL);
    const r = await finalizeKmStructureNode.execute(state, stubContext);
    assert.equal(r.output, 'success');
  });
});
