// Unit tests for class-sample concept capability nodes.
import { describe, it } from 'node:test';
import { Batch } from '@studnicky/dagonizer';
import assert from 'node:assert/strict';

import { loadAndCommonNode }           from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import { sectionWalkerNode }           from '../../../../../plugins/aonprd/capabilities/sectionWalker.js';
import { labelPairBlockNode }          from '../../../../../plugins/aonprd/capabilities/labelPairBlock.js';
import { sourceRefNode }               from '../../../../../plugins/aonprd/capabilities/sourceRef.js';
import {
  classSampleBaseNode,
  classSampleIdentityNode,
  classSampleBuildNode,
  finalizeClassSampleNode,
} from '../../../../../plugins/aonprd/concepts/class-sample.js';
import type { ClassSampleOutput } from '../../../../../plugins/aonprd/concepts/class-sample.js';
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
  await classSampleBaseNode.execute(Batch.of(state), stubContext);
  await classSampleIdentityNode.execute(Batch.of(state), stubContext);
  await classSampleBuildNode.execute(Batch.of(state), stubContext);
  await finalizeClassSampleNode.execute(Batch.of(state), stubContext);
  return ParsedOutput.as<ClassSampleOutput>(state.output);
}

// ─── extract:class-sample-base ────────────────────────────────────────────────

describe('extract:class-sample-base — class-sample-chirurgeon', () => {
  it('produces _type, name, class_sample_id', async () => {
    const state = await primeState('class-sample-chirurgeon.html', 'https://2e.aonprd.com/ClassSamples.aspx?ID=1');
    const result = await classSampleBaseNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<ClassSampleOutput>(state.output);
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name should be non-empty');
    assert.equal(out.class_sample_id, 1);
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/ClassSamples.aspx?ID=1');
    const result = await classSampleBaseNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });
});

// ─── extract:class-sample-build ──────────────────────────────────────────────

describe('extract:class-sample-build — class-sample-chirurgeon', () => {
  it('produces skills array', async () => {
    const state = await primeState('class-sample-chirurgeon.html', 'https://2e.aonprd.com/ClassSamples.aspx?ID=1');
    const result = await classSampleBuildNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<Partial<ClassSampleOutput>>(state.output);
    assert.ok(Array.isArray(out.skills), 'skills should be an array');
  });

  it('higher_level_feats is an array', async () => {
    const state = await primeState('class-sample-chirurgeon.html', 'https://2e.aonprd.com/ClassSamples.aspx?ID=1');
    await classSampleBuildNode.execute(Batch.of(state), stubContext);
    const out = ParsedOutput.as<Partial<ClassSampleOutput>>(state.output);
    assert.ok(Array.isArray(out.higher_level_feats), 'higher_level_feats should be an array');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/ClassSamples.aspx?ID=1');
    const result = await classSampleBuildNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });
});

// ─── Full pipeline ────────────────────────────────────────────────────────────

describe('full class-sample pipeline — class-sample-chirurgeon', () => {
  it('produces a complete ClassSampleOutput with all required fields', async () => {
    const out = await primeAndRunFull('class-sample-chirurgeon.html', 'https://2e.aonprd.com/ClassSamples.aspx?ID=1');

    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name missing');
    assert.ok(Array.isArray(out.skills), 'skills missing');
    assert.ok(Array.isArray(out.higher_level_feats), 'higher_level_feats missing');
    assert.ok(Array.isArray(out.sections), 'sections missing');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
    assert.ok(Array.isArray(out.links), 'links missing');
    assert.ok(typeof out.body_text === 'string', 'body_text missing');
  });
});
