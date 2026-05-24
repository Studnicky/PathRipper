// Unit tests for vehicle concept capability nodes (Phase 6.4).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { loadAndCommonNode }           from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import { sectionWalkerNode }           from '../../../../../plugins/aonprd/capabilities/sectionWalker.js';
import { labelPairBlockNode }          from '../../../../../plugins/aonprd/capabilities/labelPairBlock.js';
import { sourceRefNode }               from '../../../../../plugins/aonprd/capabilities/sourceRef.js';
import {
  vehicleBaseNode,
  vehicleMechanicsNode,
  finalizeVehicleNode,
} from '../../../../../plugins/aonprd/concepts/vehicle.js';
import type { VehicleOutput } from '../../../../../plugins/aonprd/concepts/vehicle.js';
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
  await vehicleBaseNode.execute(state, stubContext);
  await vehicleMechanicsNode.execute(state, stubContext);
  await finalizeVehicleNode.execute(state, stubContext);
  return state.output as VehicleOutput;
}

describe('extract:vehicle-base — vehicle-airship', () => {
  it('produces _type, name, vehicle_id', async () => {
    const state = await primeState('vehicle-airship.html', 'https://2e.aonprd.com/Vehicles.aspx?ID=1');
    const r = await vehicleBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as VehicleOutput;
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name should be non-empty');
    assert.equal(out.vehicle_id, 1);
  });

  it('captures source and traits', async () => {
    const state = await primeState('vehicle-airship.html', 'https://2e.aonprd.com/Vehicles.aspx?ID=1');
    await vehicleBaseNode.execute(state, stubContext);
    const out = state.output as VehicleOutput;
    assert.ok(out.source !== undefined, 'source missing');
    assert.ok(Array.isArray(out.traits), 'traits should be array');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Vehicles.aspx?ID=1');
    const r = await vehicleBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('extract:vehicle-mechanics — vehicle-airship', () => {
  it('produces price, crew, ac, hp, piloting_checks', async () => {
    const state = await primeState('vehicle-airship.html', 'https://2e.aonprd.com/Vehicles.aspx?ID=1');
    await vehicleBaseNode.execute(state, stubContext);
    const r = await vehicleMechanicsNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as VehicleOutput;
    assert.ok('price' in out, 'price missing');
    assert.ok('crew' in out, 'crew missing');
    assert.ok('ac' in out, 'ac missing');
    assert.ok('hp' in out, 'hp missing');
    assert.ok(Array.isArray(out.piloting_checks), 'piloting_checks should be array');
  });

  it('error path — returns error when prerequisites missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Vehicles.aspx?ID=1');
    const r = await vehicleMechanicsNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('finalize:vehicle — vehicle-airship', () => {
  it('produces operator_actions, description, sections, raw_fields', async () => {
    const state = await primeState('vehicle-airship.html', 'https://2e.aonprd.com/Vehicles.aspx?ID=1');
    await vehicleBaseNode.execute(state, stubContext);
    await vehicleMechanicsNode.execute(state, stubContext);
    const r = await finalizeVehicleNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as VehicleOutput;
    assert.ok(Array.isArray(out.operator_actions), 'operator_actions missing');
    assert.ok('description_text' in out, 'description_text missing');
    assert.ok(Array.isArray(out.sections), 'sections missing');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
  });

  it('error path — soft-fails to success when prerequisites missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Vehicles.aspx?ID=1');
    const r = await finalizeVehicleNode.execute(state, stubContext);
    assert.equal(r.output, 'success');
  });
});

describe('full vehicle pipeline — vehicle-airship', () => {
  it('produces complete VehicleOutput', async () => {
    const out = await primeAndRunFull('vehicle-airship.html', 'https://2e.aonprd.com/Vehicles.aspx?ID=1');
    assert.equal(out.vehicle_id, 1);
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name missing');
    assert.ok(Array.isArray(out.operator_actions), 'operator_actions missing');
    assert.ok(Array.isArray(out.piloting_checks), 'piloting_checks missing');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
  });
});
