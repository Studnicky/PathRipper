// Unit tests for km-war-tactic concept capability nodes.
import { describe, it } from 'node:test';
import { Batch } from '@studnicky/dagonizer';
import assert from 'node:assert/strict';

import { loadAndCommonNode }          from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import {
  kmWarTacticBaseNode,
  kmWarTacticMechanicsNode,
  finalizeKmWarTacticNode,
} from '../../../../../plugins/aonprd/concepts/km-war-tactic.js';
import type { KmWarTacticOutput } from '../../../../../plugins/aonprd/concepts/km-war-tactic.js';
import { loadFixture, makeState, stubContext } from '../nodes/helpers.js';
import { ParsedOutput } from '../../../../helpers/ParsedOutput.js';

const FIXTURE = 'km-war-tactic-ambush.html';
const URL     = 'https://2e.aonprd.com/KMWarTactics.aspx?ID=1';

async function primeState() {
  const html  = await loadFixture(FIXTURE);
  const state = makeState(html, URL);
  await loadAndCommonNode.execute(Batch.of(state), stubContext);
  return state;
}

async function primeAndRunFull() {
  const state = await primeState();
  await kmWarTacticBaseNode.execute(Batch.of(state), stubContext);
  await kmWarTacticMechanicsNode.execute(Batch.of(state), stubContext);
  await finalizeKmWarTacticNode.execute(Batch.of(state), stubContext);
  return ParsedOutput.as<KmWarTacticOutput>(state.output);
}

describe('extract:km-war-tactic-base — km-war-tactic-ambush', () => {
  it('produces _type, name, tactic_id, and army_types', async () => {
    const state = await primeState();
    const result = await kmWarTacticBaseNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<KmWarTacticOutput>(state.output);
    assert.equal(out.name, 'Ambush');
    assert.equal(out.tactic_id, 1);
    assert.ok(Array.isArray(out.traits), 'traits is array');
    assert.ok(Array.isArray(out.army_types), 'army_types is array');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', URL);
    const result = await kmWarTacticBaseNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });
});

describe('extract:km-war-tactic-mechanics — km-war-tactic-ambush', () => {
  it('produces effect and mechanic fields', async () => {
    const state = await primeState();
    await kmWarTacticBaseNode.execute(Batch.of(state), stubContext);
    const result = await kmWarTacticMechanicsNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<KmWarTacticOutput>(state.output);
    assert.ok(typeof out.effect === 'string', 'effect is string');
    assert.ok(out.effect.length > 0, 'effect is non-empty');
    assert.ok('prerequisites' in out, 'prerequisites field present');
    assert.ok('requirements' in out, 'requirements field present');
    assert.ok('frequency' in out, 'frequency field present');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', URL);
    const result = await kmWarTacticMechanicsNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });
});

describe('finalize:km-war-tactic — km-war-tactic-ambush', () => {
  it('assembles complete KmWarTacticOutput with all required fields', async () => {
    const out = await primeAndRunFull();
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
    const result = await finalizeKmWarTacticNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));
  });
});
