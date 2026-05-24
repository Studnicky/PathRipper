// Unit tests for camp-activity concept capability nodes.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { loadAndCommonNode }          from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import {
  campActivityBaseNode,
  campActivityMechanicsNode,
  finalizeCampActivityNode,
} from '../../../../../plugins/aonprd/concepts/camp-activity.js';
import type { CampActivityOutput } from '../../../../../plugins/aonprd/concepts/camp-activity.js';
import { loadFixture, makeState, stubContext } from '../nodes/helpers.js';

const FIXTURE = 'camp-activity-camouflage-campsite.html';
const URL     = 'https://2e.aonprd.com/CampActivities.aspx?ID=1472';

async function primeState() {
  const html  = await loadFixture(FIXTURE);
  const state = makeState(html, URL);
  await loadAndCommonNode.execute(state, stubContext);
  return state;
}

async function primeAndRunFull() {
  const state = await primeState();
  await campActivityBaseNode.execute(state, stubContext);
  await campActivityMechanicsNode.execute(state, stubContext);
  await finalizeCampActivityNode.execute(state, stubContext);
  return state.output as CampActivityOutput;
}

describe('extract:camp-activity-base — camp-activity-camouflage-campsite', () => {
  it('produces _type, name, activity_id', async () => {
    const state = await primeState();
    const r = await campActivityBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as CampActivityOutput;
    assert.equal(out.name, 'Camouflage Campsite');
    assert.equal(out.activity_id, 1472);
    assert.ok(Array.isArray(out.traits), 'traits is array');
    assert.ok('action_cost' in out, 'action_cost field present');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', URL);
    const r = await campActivityBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('extract:camp-activity-mechanics — camp-activity-camouflage-campsite', () => {
  it('produces outcomes array and description', async () => {
    const state = await primeState();
    await campActivityBaseNode.execute(state, stubContext);
    const r = await campActivityMechanicsNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as CampActivityOutput;
    assert.ok(Array.isArray(out.outcomes), 'outcomes is array');
    assert.ok(out.outcomes.length > 0, 'at least one outcome parsed');
    assert.ok(typeof out.description === 'string', 'description is string');
    assert.ok('requirements' in out, 'requirements field present');
    assert.ok('frequency' in out, 'frequency field present');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', URL);
    const r = await campActivityMechanicsNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('finalize:camp-activity — camp-activity-camouflage-campsite', () => {
  it('assembles complete CampActivityOutput with all required fields', async () => {
    const out = await primeAndRunFull();
    assert.equal(out.name, 'Camouflage Campsite');
    assert.equal(out.activity_id, 1472);
    assert.ok(Array.isArray(out.outcomes), 'outcomes present');
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
    assert.equal(out.raw_fields['Requirements'], undefined, 'Requirements stripped');
    assert.equal(out.raw_fields['Critical Success'], undefined, 'Critical Success stripped');
  });

  it('error path — soft-fails to success when prerequisites missing', async () => {
    const state = makeState('', URL);
    const r = await finalizeCampActivityNode.execute(state, stubContext);
    assert.equal(r.output, 'success');
  });
});
