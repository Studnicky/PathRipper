// Unit tests for hazard concept capability nodes (Phase 6.4).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { loadAndCommonNode }           from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import { sectionWalkerNode }           from '../../../../../plugins/aonprd/capabilities/sectionWalker.js';
import { labelPairBlockNode }          from '../../../../../plugins/aonprd/capabilities/labelPairBlock.js';
import { sourceRefNode }               from '../../../../../plugins/aonprd/capabilities/sourceRef.js';
import {
  hazardBaseNode,
  hazardDefensesNode,
  finalizeHazardNode,
} from '../../../../../plugins/aonprd/concepts/hazard/index.js';
import type { HazardOutput } from '../../../../../plugins/aonprd/concepts/hazard/index.js';
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
  await hazardBaseNode.execute(state, stubContext);
  await hazardDefensesNode.execute(state, stubContext);
  await finalizeHazardNode.execute(state, stubContext);
  return state.output as HazardOutput;
}

describe('extract:hazard-base — hazard-haunted-bridge', () => {
  it('produces _type, name, hazard_id, complexity, stealth', async () => {
    const state = await primeState('hazard-haunted-bridge.html', 'https://2e.aonprd.com/Hazards.aspx?ID=1');
    const r = await hazardBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as HazardOutput;
    assert.equal(out._type, 'hazard');
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name should be non-empty');
    assert.equal(out.hazard_id, 1);
    assert.ok('complexity' in out, 'complexity field missing');
    assert.ok('stealth' in out, 'stealth field missing');
  });

  it('complexity is "simple" for haunted bridge', async () => {
    const state = await primeState('hazard-haunted-bridge.html', 'https://2e.aonprd.com/Hazards.aspx?ID=1');
    await hazardBaseNode.execute(state, stubContext);

    const out = state.output as HazardOutput;
    assert.equal(out.complexity, 'simple', 'haunted bridge has Complexity Simple');
  });

  it('stealth has a dc value', async () => {
    const state = await primeState('hazard-haunted-bridge.html', 'https://2e.aonprd.com/Hazards.aspx?ID=1');
    await hazardBaseNode.execute(state, stubContext);

    const out = state.output as HazardOutput;
    assert.ok(out.stealth.dc !== null, 'stealth.dc should be non-null for haunted bridge');
    assert.equal(out.stealth.dc, 20);
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Hazards.aspx?ID=1');
    const r = await hazardBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('extract:hazard-defenses — hazard-haunted-bridge', () => {
  it('produces defenses with ac, saves, hp', async () => {
    const state = await primeState('hazard-haunted-bridge.html', 'https://2e.aonprd.com/Hazards.aspx?ID=1');
    await hazardBaseNode.execute(state, stubContext);
    const r = await hazardDefensesNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as HazardOutput;
    assert.ok(typeof out.defenses === 'object', 'defenses missing');
    // ac and saves may be null but the fields must exist
    assert.ok('ac' in out.defenses, 'defenses.ac missing');
    assert.ok('saves' in out.defenses, 'defenses.saves missing');
    assert.ok(Array.isArray(out.defenses.hp), 'defenses.hp should be array');
  });

  it('error path — returns error when prerequisites missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Hazards.aspx?ID=1');
    const r = await hazardDefensesNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('finalize:hazard — hazard-haunted-bridge', () => {
  it('produces routines, reset, sections, raw_fields', async () => {
    const state = await primeState('hazard-haunted-bridge.html', 'https://2e.aonprd.com/Hazards.aspx?ID=1');
    await hazardBaseNode.execute(state, stubContext);
    await hazardDefensesNode.execute(state, stubContext);
    const r = await finalizeHazardNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as HazardOutput;
    assert.ok(Array.isArray(out.routines), 'routines missing');
    assert.ok('reset' in out, 'reset field missing');
    assert.ok(Array.isArray(out.sections), 'sections missing');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
  });

  it('error path — soft-fails to success when prerequisites missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Hazards.aspx?ID=1');
    const r = await finalizeHazardNode.execute(state, stubContext);
    assert.equal(r.output, 'success');
  });
});

describe('full hazard pipeline — hazard-haunted-bridge', () => {
  it('produces complete HazardOutput', async () => {
    const out = await primeAndRunFull('hazard-haunted-bridge.html', 'https://2e.aonprd.com/Hazards.aspx?ID=1');
    assert.equal(out._type, 'hazard');
    assert.equal(out.hazard_id, 1);
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name missing');
    assert.equal(out.complexity, 'simple');
    assert.ok(typeof out.defenses === 'object', 'defenses missing');
    assert.ok(Array.isArray(out.routines), 'routines missing');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
  });

  it('sections[] does not contain legacy-content-warning', async () => {
    const out = await primeAndRunFull('hazard-haunted-bridge.html', 'https://2e.aonprd.com/Hazards.aspx?ID=1');
    const legacySection = out.sections.find((s) =>
      /legacy[\s-]content[\s-]warning/i.test(s.heading),
    );
    assert.equal(legacySection, undefined, 'legacy-content-warning section should be filtered');
  });
});
