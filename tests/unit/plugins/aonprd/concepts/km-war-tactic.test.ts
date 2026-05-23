// Unit tests for km-war-tactic concept capability nodes (Phase 6.4).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { loadAndCommonNode }          from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import {
  kmWarTacticBaseNode,
  kmWarTacticMechanicsNode,
  finalizeKmWarTacticNode,
} from '../../../../../plugins/aonprd/concepts/km-war-tactic.js';
import type { KmWarTacticOutput } from '../../../../../plugins/aonprd/concepts/km-war-tactic.js';
import { loadFixture, makeState, stubContext } from '../nodes/helpers.js';

const FIXTURE = 'km-war-tactic-ambush.html';
const URL     = 'https://2e.aonprd.com/KMWarTactics.aspx?ID=1';

async function primeState() {
  const html  = await loadFixture(FIXTURE);
  const state = makeState(html, URL);
  await loadAndCommonNode.execute(state, stubContext);
  return state;
}

async function primeAndRunFull() {
  const state = await primeState();
  await kmWarTacticBaseNode.execute(state, stubContext);
  await kmWarTacticMechanicsNode.execute(state, stubContext);
  await finalizeKmWarTacticNode.execute(state, stubContext);
  return state.output as KmWarTacticOutput;
}

describe('extract:km-war-tactic-base — km-war-tactic-ambush', () => {
  it('produces _type, name, tactic_id, and army_types', async () => {
    const state = await primeState();
    const r = await kmWarTacticBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as KmWarTacticOutput;
    assert.equal(out._type, 'km-war-tactic');
    assert.equal(out.name, 'Ambush');
    assert.equal(out.tactic_id, 1);
    assert.ok(Array.isArray(out.traits), 'traits is array');
    assert.ok(Array.isArray(out.army_types), 'army_types is array');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', URL);
    const r = await kmWarTacticBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('extract:km-war-tactic-mechanics — km-war-tactic-ambush', () => {
  it('produces effect and mechanic fields', async () => {
    const state = await primeState();
    await kmWarTacticBaseNode.execute(state, stubContext);
    const r = await kmWarTacticMechanicsNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as KmWarTacticOutput;
    assert.ok(typeof out.effect === 'string', 'effect is string');
    assert.ok(out.effect.length > 0, 'effect is non-empty');
    assert.ok('prerequisites' in out, 'prerequisites field present');
    assert.ok('requirements' in out, 'requirements field present');
    assert.ok('frequency' in out, 'frequency field present');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', URL);
    const r = await kmWarTacticMechanicsNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('finalize:km-war-tactic — km-war-tactic-ambush', () => {
  it('assembles complete KmWarTacticOutput with all required fields', async () => {
    const out = await primeAndRunFull();
    assert.equal(out._type, 'km-war-tactic');
    assert.equal(out.name, 'Ambush');
    assert.equal(out.tactic_id, 1);
    assert.ok(Array.isArray(out.army_types), 'army_types present');
    assert.ok(typeof out.effect === 'string', 'effect present');
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
    assert.equal(out.raw_fields['Prerequisites'], undefined, 'Prerequisites stripped');
    assert.equal(out.raw_fields['Frequency'], undefined, 'Frequency stripped');
  });

  it('error path — soft-fails to success when prerequisites missing', async () => {
    const state = makeState('', URL);
    const r = await finalizeKmWarTacticNode.execute(state, stubContext);
    assert.equal(r.output, 'success');
  });
});
