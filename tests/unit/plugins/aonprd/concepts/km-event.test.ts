// Unit tests for km-event concept capability nodes (Phase 6.4).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { loadAndCommonNode }      from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import {
  kmEventBaseNode,
  kmEventMechanicsNode,
  finalizeKmEventNode,
} from '../../../../../plugins/aonprd/concepts/km-event.js';
import type { KmEventOutput } from '../../../../../plugins/aonprd/concepts/km-event.js';
import { loadFixture, makeState, stubContext } from '../nodes/helpers.js';

const FIXTURE = 'km-event-archaeological-find.html';
const URL     = 'https://2e.aonprd.com/KMEvents.aspx?ID=1';

async function primeState() {
  const html  = await loadFixture(FIXTURE);
  const state = makeState(html, URL);
  await loadAndCommonNode.execute(state, stubContext);
  return state;
}

async function primeAndRunFull() {
  const state = await primeState();
  await kmEventBaseNode.execute(state, stubContext);
  await kmEventMechanicsNode.execute(state, stubContext);
  await finalizeKmEventNode.execute(state, stubContext);
  return state.output as KmEventOutput;
}

describe('extract:km-event-base — km-event-archaeological-find', () => {
  it('produces _type, name, event_id', async () => {
    const state = await primeState();
    const r = await kmEventBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as KmEventOutput;
    assert.equal(out._type, 'km-event');
    assert.equal(out.name, 'Archaeological Find');
    assert.equal(out.event_id, 1);
    assert.ok(Array.isArray(out.traits), 'traits is array');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', URL);
    const r = await kmEventBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('extract:km-event-mechanics — km-event-archaeological-find', () => {
  it('produces outcomes array and description', async () => {
    const state = await primeState();
    await kmEventBaseNode.execute(state, stubContext);
    const r = await kmEventMechanicsNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as KmEventOutput;
    assert.ok(Array.isArray(out.outcomes), 'outcomes is array');
    assert.ok(out.outcomes.length > 0, 'at least one outcome parsed');
    assert.ok(typeof out.description === 'string', 'description is string');
    assert.ok('kingdom_skill' in out, 'kingdom_skill field present');
    assert.ok('location' in out, 'location field present');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', URL);
    const r = await kmEventMechanicsNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('finalize:km-event — km-event-archaeological-find', () => {
  it('assembles complete KmEventOutput with all required fields', async () => {
    const out = await primeAndRunFull();
    assert.equal(out._type, 'km-event');
    assert.equal(out.name, 'Archaeological Find');
    assert.equal(out.event_id, 1);
    assert.ok(Array.isArray(out.outcomes), 'outcomes present');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields present');
    assert.ok(typeof out.body_html === 'string', 'body_html present');
    assert.ok(Array.isArray(out.links), 'links present');
    assert.ok('meta_description' in out, 'meta_description present');
    assert.ok('meta_keywords' in out, 'meta_keywords present');
  });

  it('strips claimed AON labels from raw_fields', async () => {
    const out = await primeAndRunFull();
    assert.equal(out.raw_fields['Source'], undefined, 'Source stripped');
    assert.equal(out.raw_fields['Kingdom Skill'], undefined, 'Kingdom Skill stripped');
  });

  it('error path — soft-fails to success when prerequisites missing', async () => {
    const state = makeState('', URL);
    const r = await finalizeKmEventNode.execute(state, stubContext);
    assert.equal(r.output, 'success');
  });
});
