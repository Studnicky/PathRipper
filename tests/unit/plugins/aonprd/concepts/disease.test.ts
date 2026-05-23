// Unit tests for disease concept capability nodes (Phase 6.4).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { loadAndCommonNode }  from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import {
  diseaseBaseNode,
  diseaseMechanicsNode,
  diseaseStagesNode,
  finalizeDiseaseNode,
} from '../../../../../plugins/aonprd/concepts/disease.js';
import type { DiseaseOutput } from '../../../../../plugins/aonprd/concepts/disease.js';
import { loadFixture, makeState, stubContext } from '../nodes/helpers.js';

const FIXTURE = 'disease-bubonic-plague.html';
const URL     = 'https://2e.aonprd.com/Diseases.aspx?ID=1';

async function primeState() {
  const html  = await loadFixture(FIXTURE);
  const state = makeState(html, URL);
  await loadAndCommonNode.execute(state, stubContext);
  return state;
}

async function primeAndRunFull() {
  const state = await primeState();
  await diseaseBaseNode.execute(state, stubContext);
  await diseaseMechanicsNode.execute(state, stubContext);
  await diseaseStagesNode.execute(state, stubContext);
  await finalizeDiseaseNode.execute(state, stubContext);
  return state.output as DiseaseOutput;
}

describe('extract:disease-base — disease-bubonic-plague', () => {
  it('produces _type, name, disease_id, level', async () => {
    const state = await primeState();
    const r = await diseaseBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as DiseaseOutput;
    assert.equal(out._type, 'disease');
    assert.equal(out.name, 'Bubonic Plague');
    assert.equal(out.disease_id, 1);
    assert.equal(out.level, 7);
    assert.ok(Array.isArray(out.traits), 'traits is array');
    assert.ok(out.traits.includes('Disease'), 'Disease trait present');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', URL);
    const r = await diseaseBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('extract:disease-mechanics — disease-bubonic-plague', () => {
  it('produces saving_throw, onset, maximum_duration', async () => {
    const state = await primeState();
    await diseaseBaseNode.execute(state, stubContext);
    const r = await diseaseMechanicsNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as DiseaseOutput;
    assert.ok(out.saving_throw !== null, 'saving_throw present');
    assert.equal(out.saving_throw?.dc, 22);
    assert.equal(out.saving_throw?.save, 'Fortitude');
    assert.equal(out.saving_throw?.basic, false);
    assert.equal(out.onset, '1d4 days');
    assert.equal(out.maximum_duration, '8 days');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', URL);
    const r = await diseaseMechanicsNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('extract:disease-stages — disease-bubonic-plague', () => {
  it('produces 4 stages', async () => {
    const state = await primeState();
    await diseaseBaseNode.execute(state, stubContext);
    const r = await diseaseStagesNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as DiseaseOutput;
    assert.ok(Array.isArray(out.stages), 'stages is array');
    assert.equal(out.stages.length, 4, 'four stages parsed');
    assert.equal(out.stages[0]?.stage, 1);
    assert.ok(out.stages[0]?.body_text.includes('fatigued'), 'stage 1 includes fatigued');
    assert.equal(out.stages[3]?.stage, 4);
    assert.ok(out.stages[3]?.body_text.includes('dead'), 'stage 4 includes dead');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', URL);
    const r = await diseaseStagesNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('finalize:disease — disease-bubonic-plague', () => {
  it('assembles complete DiseaseOutput with all required fields', async () => {
    const out = await primeAndRunFull();
    assert.equal(out._type, 'disease');
    assert.equal(out.name, 'Bubonic Plague');
    assert.equal(out.disease_id, 1);
    assert.ok(Array.isArray(out.stages), 'stages present');
    assert.equal(out.stages.length, 4, 'four stages assembled');
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
    const r = await finalizeDiseaseNode.execute(state, stubContext);
    assert.equal(r.output, 'success');
  });
});
