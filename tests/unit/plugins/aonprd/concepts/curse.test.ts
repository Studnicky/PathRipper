// Unit tests for curse concept capability nodes.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { loadAndCommonNode }  from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import {
  curseBaseNode,
  curseMechanicsNode,
  curseStagesNode,
  finalizeCurseNode,
} from '../../../../../plugins/aonprd/concepts/curse.js';
import type { CurseOutput } from '../../../../../plugins/aonprd/concepts/curse.js';
import { loadFixture, makeState, stubContext } from '../nodes/helpers.js';

const FIXTURE = 'curse-mummy-rot.html';
const URL     = 'https://2e.aonprd.com/Curses.aspx?ID=57';

async function primeState() {
  const html  = await loadFixture(FIXTURE);
  const state = makeState(html, URL);
  await loadAndCommonNode.execute(state, stubContext);
  return state;
}

async function primeAndRunFull() {
  const state = await primeState();
  await curseBaseNode.execute(state, stubContext);
  await curseMechanicsNode.execute(state, stubContext);
  await curseStagesNode.execute(state, stubContext);
  await finalizeCurseNode.execute(state, stubContext);
  return state.output as CurseOutput;
}

describe('extract:curse-base — curse-mummy-rot', () => {
  it('produces _type, name, curse_id, level', async () => {
    const state = await primeState();
    const r = await curseBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as CurseOutput;
    assert.equal(out.name, 'Mummy Rot');
    assert.equal(out.curse_id, 57);
    assert.equal(out.level, 11);
    assert.ok(Array.isArray(out.traits), 'traits is array');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', URL);
    const r = await curseBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('extract:curse-mechanics — curse-mummy-rot', () => {
  it('produces saving_throw, onset, maximum_duration', async () => {
    const state = await primeState();
    await curseBaseNode.execute(state, stubContext);
    const r = await curseMechanicsNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as CurseOutput;
    assert.ok(out.saving_throw !== null, 'saving_throw present');
    assert.equal(out.saving_throw?.dc, 28);
    assert.equal(out.saving_throw?.save, 'Will');
    assert.equal(out.saving_throw?.basic, false);
    assert.equal(out.onset, '1 day');
    assert.equal(out.maximum_duration, '2d6 days');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', URL);
    const r = await curseMechanicsNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('extract:curse-stages — curse-mummy-rot', () => {
  it('produces 3 stages with durations', async () => {
    const state = await primeState();
    await curseBaseNode.execute(state, stubContext);
    const r = await curseStagesNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as CurseOutput;
    assert.ok(Array.isArray(out.stages), 'stages is array');
    assert.equal(out.stages.length, 3, 'three stages parsed');
    assert.equal(out.stages[0]?.stage, 1);
    assert.equal(out.stages[0]?.duration, '1 day');
    assert.ok(out.stages[0]?.body_text.includes('drained 2'), 'stage 1 body includes drained 2');
    assert.equal(out.stages[2]?.stage, 3);
    assert.ok(out.stages[2]?.body_text.includes('crumbles to dust'), 'stage 3 body includes crumbles to dust');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', URL);
    const r = await curseStagesNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('finalize:curse — curse-mummy-rot', () => {
  it('assembles complete CurseOutput with all required fields', async () => {
    const out = await primeAndRunFull();
    assert.equal(out.name, 'Mummy Rot');
    assert.equal(out.curse_id, 57);
    assert.ok(Array.isArray(out.stages), 'stages present');
    assert.ok(out.saving_throw !== null, 'saving_throw present');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields present');
    assert.ok(typeof out.body_html === 'string', 'body_html present');
    assert.ok(Array.isArray(out.links), 'links present');
    assert.ok('meta_description' in out, 'meta_description present');
    assert.ok('meta_keywords' in out, 'meta_keywords present');
  });

  it('strips claimed AON labels from raw_fields', async () => {
    const out = await primeAndRunFull();
    assert.equal(out.raw_fields['Source'], undefined, 'Source stripped');
    assert.equal(out.raw_fields['Saving Throw'], undefined, 'Saving Throw stripped');
    assert.equal(out.raw_fields['Onset'], undefined, 'Onset stripped');
    assert.equal(out.raw_fields['Maximum Duration'], undefined, 'Maximum Duration stripped');
  });

  it('error path — soft-fails to success when prerequisites missing', async () => {
    const state = makeState('', URL);
    const r = await finalizeCurseNode.execute(state, stubContext);
    assert.equal(r.output, 'success');
  });
});
