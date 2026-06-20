// Unit tests for relic concept capability nodes.
import { describe, it } from 'node:test';
import { Batch } from '@studnicky/dagonizer';
import assert from 'node:assert/strict';

import { loadAndCommonNode }           from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import { sectionWalkerNode }           from '../../../../../plugins/aonprd/capabilities/sectionWalker.js';
import { labelPairBlockNode }          from '../../../../../plugins/aonprd/capabilities/labelPairBlock.js';
import { sourceRefNode }               from '../../../../../plugins/aonprd/capabilities/sourceRef.js';
import {
  relicBaseNode,
  relicGiftNode,
  finalizeRelicNode,
} from '../../../../../plugins/aonprd/concepts/relic.js';
import type { RelicOutput } from '../../../../../plugins/aonprd/concepts/relic.js';
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
  await relicBaseNode.execute(Batch.of(state), stubContext);
  await relicGiftNode.execute(Batch.of(state), stubContext);
  await finalizeRelicNode.execute(Batch.of(state), stubContext);
  return ParsedOutput.as<RelicOutput>(state.output);
}

describe('extract:relic-base — relic-righteous-call', () => {
  it('produces _type, name, relic_id', async () => {
    const state = await primeState('relic-righteous-call.html', 'https://2e.aonprd.com/Relics.aspx?ID=1');
    const result = await relicBaseNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<RelicOutput>(state.output);
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name should be non-empty');
    assert.equal(out.relic_id, 1);
  });

  it('captures source and traits', async () => {
    const state = await primeState('relic-righteous-call.html', 'https://2e.aonprd.com/Relics.aspx?ID=1');
    await relicBaseNode.execute(Batch.of(state), stubContext);
    const out = ParsedOutput.as<RelicOutput>(state.output);
    assert.ok(out.source !== undefined, 'source missing');
    assert.ok(Array.isArray(out.traits), 'traits should be array');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Relics.aspx?ID=1');
    const result = await relicBaseNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });
});

describe('extract:relic-gift — relic-righteous-call', () => {
  it('produces gift, aspects, milestones fields', async () => {
    const state = await primeState('relic-righteous-call.html', 'https://2e.aonprd.com/Relics.aspx?ID=1');
    await relicBaseNode.execute(Batch.of(state), stubContext);
    const result = await relicGiftNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<RelicOutput>(state.output);
    assert.ok('gift' in out, 'gift field missing');
    assert.ok('aspects' in out, 'aspects field missing');
    assert.ok('milestones' in out, 'milestones field missing');
    assert.ok(Array.isArray(out.aspects), 'aspects should be array');
    assert.ok(Array.isArray(out.milestones), 'milestones should be array');
  });

  it('error path — returns error when prerequisites missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Relics.aspx?ID=1');
    const result = await relicGiftNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });
});

describe('finalize:relic — relic-righteous-call', () => {
  it('produces sections, raw_fields, body fields', async () => {
    const state = await primeState('relic-righteous-call.html', 'https://2e.aonprd.com/Relics.aspx?ID=1');
    await relicBaseNode.execute(Batch.of(state), stubContext);
    await relicGiftNode.execute(Batch.of(state), stubContext);
    const result = await finalizeRelicNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<RelicOutput>(state.output);
    assert.ok(Array.isArray(out.sections), 'sections missing');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
    assert.ok(typeof out.body_text === 'string', 'body_text missing');
  });

  it('error path — soft-fails to success when prerequisites missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Relics.aspx?ID=1');
    const result = await finalizeRelicNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));
  });
});

describe('full relic pipeline — relic-righteous-call', () => {
  it('produces complete RelicOutput', async () => {
    const out = await primeAndRunFull('relic-righteous-call.html', 'https://2e.aonprd.com/Relics.aspx?ID=1');
    assert.equal(out.relic_id, 1);
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name missing');
    assert.ok('gift' in out, 'gift missing');
    assert.ok(Array.isArray(out.milestones), 'milestones missing');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
  });
});
