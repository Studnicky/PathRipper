// Unit tests for condition concept capability nodes.
import { describe, it } from 'node:test';
import { Batch } from '@studnicky/dagonizer';
import assert from 'node:assert/strict';

import { loadAndCommonNode }           from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import { sectionWalkerNode }           from '../../../../../plugins/aonprd/capabilities/sectionWalker.js';
import { labelPairBlockNode }          from '../../../../../plugins/aonprd/capabilities/labelPairBlock.js';
import { sourceRefNode }               from '../../../../../plugins/aonprd/capabilities/sourceRef.js';
import {
  conditionBaseNode,
  finalizeConditionNode,
} from '../../../../../plugins/aonprd/concepts/condition/index.js';
import type { ConditionOutput } from '../../../../../plugins/aonprd/concepts/condition/index.js';
import { loadFixture, makeState, stubContext } from '../nodes/helpers.js';
import { ParsedOutput } from '../../../../helpers/ParsedOutput.js';

async function primeState(fixtureName: string, url: string) {
  const html  = await loadFixture(fixtureName);
  const state = makeState(html, url);
  await loadAndCommonNode.execute(Batch.of(state), stubContext);
  await labelPairBlockNode.execute(Batch.of(state), stubContext);
  await sectionWalkerNode.execute(Batch.of(state), stubContext);
  await sourceRefNode.execute(Batch.of(state), stubContext);
  return state;
}

async function primeAndRunFull(fixtureName: string, url: string) {
  const state = await primeState(fixtureName, url);
  await conditionBaseNode.execute(Batch.of(state), stubContext);
  await finalizeConditionNode.execute(Batch.of(state), stubContext);
  return ParsedOutput.as<ConditionOutput>(state.output);
}

describe('extract:condition-base — condition-blinded', () => {
  it('produces _type, name, condition_id, stages, related_conditions', async () => {
    const state = await primeState('condition-blinded.html', 'https://2e.aonprd.com/Conditions.aspx?ID=59');
    const result = await conditionBaseNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<ConditionOutput>(state.output);
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name should be non-empty');
    assert.equal(out.condition_id, 59);
    assert.ok(Array.isArray(out.stages), 'stages should be an array');
    assert.ok(Array.isArray(out.related_conditions), 'related_conditions should be an array');
  });

  it('blinded condition has no Stage progression', async () => {
    const state = await primeState('condition-blinded.html', 'https://2e.aonprd.com/Conditions.aspx?ID=59');
    await conditionBaseNode.execute(Batch.of(state), stubContext);

    const out = ParsedOutput.as<ConditionOutput>(state.output);
    assert.equal(out.stages.length, 0, 'Blinded has no stage progression');
  });

  it('related_conditions references dazzled (linked from blinded body)', async () => {
    const state = await primeState('condition-blinded.html', 'https://2e.aonprd.com/Conditions.aspx?ID=59');
    await conditionBaseNode.execute(Batch.of(state), stubContext);

    const out = ParsedOutput.as<ConditionOutput>(state.output);
    // Blinded page links to dazzled — should appear in related_conditions
    const hasDazzled = out.related_conditions.some(
      (cond) => cond.name.toLowerCase().includes('dazzled'),
    );
    assert.ok(hasDazzled, 'related_conditions should include dazzled');
  });

  it('error path — returns error when prerequisites missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Conditions.aspx?ID=59');
    const result = await conditionBaseNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });
});

describe('finalize:condition — condition-blinded', () => {
  it('produces sections (legacy-filtered), raw_fields, body_text', async () => {
    const state = await primeState('condition-blinded.html', 'https://2e.aonprd.com/Conditions.aspx?ID=59');
    await conditionBaseNode.execute(Batch.of(state), stubContext);
    const result = await finalizeConditionNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<ConditionOutput>(state.output);
    assert.ok(Array.isArray(out.sections), 'sections missing');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
    assert.ok(typeof out.body_text === 'string', 'body_text missing');
  });

  it('sections[] does not contain legacy-content-warning', async () => {
    const out = await primeAndRunFull('condition-blinded.html', 'https://2e.aonprd.com/Conditions.aspx?ID=59');
    const legacySection = out.sections.find((sec) =>
      /legacy[\s-]content[\s-]warning/i.test(sec.heading),
    );
    assert.equal(legacySection, undefined, 'legacy-content-warning section should be filtered');
  });

  it('error path — soft-fails to success when prerequisites missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Conditions.aspx?ID=59');
    const result = await finalizeConditionNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));
  });
});

describe('full condition pipeline — condition-blinded', () => {
  it('produces complete ConditionOutput', async () => {
    const out = await primeAndRunFull('condition-blinded.html', 'https://2e.aonprd.com/Conditions.aspx?ID=59');
    assert.equal(out.condition_id, 59);
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name missing');
    assert.ok(Array.isArray(out.stages), 'stages missing');
    assert.ok(Array.isArray(out.related_conditions), 'related_conditions missing');
    assert.ok(typeof out.body_text === 'string', 'body_text missing');
  });
});
