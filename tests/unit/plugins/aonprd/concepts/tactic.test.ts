// Unit tests for tactic concept capability nodes.
import { describe, it } from 'node:test';
import { Batch } from '@studnicky/dagonizer';
import assert from 'node:assert/strict';

import { loadAndCommonNode }     from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import {
  tacticBaseNode,
  tacticMechanicsNode,
  finalizeTacticNode,
} from '../../../../../plugins/aonprd/concepts/tactic.js';
import type { TacticOutput } from '../../../../../plugins/aonprd/concepts/tactic.js';
import { loadFixture, makeState, stubContext } from '../nodes/helpers.js';
import { ParsedOutput } from '../../../../helpers/ParsedOutput.js';

// Mirrored Wall (ID=22): Two-Actions, Master category.
const FIXTURE = 'tactic-mirrored-wall.html';
const URL     = 'https://2e.aonprd.com/Tactics.aspx?ID=22';

async function primeState() {
  const html  = await loadFixture(FIXTURE);
  const state = makeState(html, URL);
  await loadAndCommonNode.execute(Batch.of(state), stubContext);
  return state;
}

async function primeAndRunFull() {
  const state = await primeState();
  await tacticBaseNode.execute(Batch.of(state), stubContext);
  await tacticMechanicsNode.execute(Batch.of(state), stubContext);
  await finalizeTacticNode.execute(Batch.of(state), stubContext);
  return ParsedOutput.as<TacticOutput>(state.output);
}

describe('extract:tactic-base — tactic-mirrored-wall', () => {
  it('produces _type, name, tactic_id, and action_cost', async () => {
    const state = await primeState();
    const result = await tacticBaseNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<TacticOutput>(state.output);
    assert.equal(out.name, 'Mirrored Wall');
    assert.equal(out.tactic_id, 22);
    assert.ok('action_cost' in out, 'action_cost field present');
    assert.ok('category' in out, 'category field present');
    // Mirrored Wall is "Master" tier
    assert.equal(out.category, 'Master');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', URL);
    const result = await tacticBaseNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });
});

describe('extract:tactic-mechanics — tactic-mirrored-wall', () => {
  it('produces effect text', async () => {
    const state = await primeState();
    await tacticBaseNode.execute(Batch.of(state), stubContext);
    const result = await tacticMechanicsNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<TacticOutput>(state.output);
    assert.ok(typeof out.effect === 'string', 'effect is string');
    assert.ok(out.effect.length > 0, 'effect is non-empty');
    assert.ok('prerequisites' in out, 'prerequisites field present');
    assert.ok('requirements' in out, 'requirements field present');
    assert.ok('trigger' in out, 'trigger field present');
    assert.ok('frequency' in out, 'frequency field present');
    assert.ok('special' in out, 'special field present');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', URL);
    const result = await tacticMechanicsNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });
});

describe('finalize:tactic — tactic-mirrored-wall', () => {
  it('assembles complete TacticOutput with all required fields', async () => {
    const out = await primeAndRunFull();
    assert.equal(out.name, 'Mirrored Wall');
    assert.equal(out.tactic_id, 22);
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
  });

  it('error path — soft-fails to success when prerequisites missing', async () => {
    const state = makeState('', URL);
    const result = await finalizeTacticNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));
  });
});
