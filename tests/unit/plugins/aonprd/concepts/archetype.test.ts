// Unit tests for archetype concept capability nodes.
import { describe, it } from 'node:test';
import { Batch } from '@studnicky/dagonizer';
import assert from 'node:assert/strict';

import { loadAndCommonNode }           from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import { sectionWalkerNode }           from '../../../../../plugins/aonprd/capabilities/sectionWalker.js';
import { labelPairBlockNode }          from '../../../../../plugins/aonprd/capabilities/labelPairBlock.js';
import { sourceRefNode }               from '../../../../../plugins/aonprd/capabilities/sourceRef.js';
import {
  archetypeBaseNode,
  archetypeIntroductionNode,
  archetypeFeatsNode,
  finalizeArchetypeNode,
} from '../../../../../plugins/aonprd/concepts/archetype.js';
import type { ArchetypeOutput } from '../../../../../plugins/aonprd/concepts/archetype.js';
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
  await archetypeBaseNode.execute(Batch.of(state), stubContext);
  await archetypeIntroductionNode.execute(Batch.of(state), stubContext);
  await archetypeFeatsNode.execute(Batch.of(state), stubContext);
  await finalizeArchetypeNode.execute(Batch.of(state), stubContext);
  return ParsedOutput.as<ArchetypeOutput>(state.output);
}

// ─── extract:archetype-base ───────────────────────────────────────────────────

describe('extract:archetype-base — archetype-geomancer', () => {
  it('produces _type, name, archetype_id', async () => {
    const state = await primeState('archetype-geomancer.html', 'https://2e.aonprd.com/Archetypes.aspx?ID=264');
    const result = await archetypeBaseNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<ArchetypeOutput>(state.output);
    assert.equal(out.name, 'Geomancer');
    assert.equal(out.archetype_id, 264);
  });

  it('source.book is populated', async () => {
    const state = await primeState('archetype-geomancer.html', 'https://2e.aonprd.com/Archetypes.aspx?ID=264');
    await archetypeBaseNode.execute(Batch.of(state), stubContext);
    const out = ParsedOutput.as<ArchetypeOutput>(state.output);
    assert.ok(out.source.book !== null, 'source.book should be non-null');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Archetypes.aspx?ID=264');
    const result = await archetypeBaseNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });
});

// ─── extract:archetype-introduction ──────────────────────────────────────────

describe('extract:archetype-introduction — archetype-geomancer', () => {
  it('produces introduction as a string', async () => {
    const state = await primeState('archetype-geomancer.html', 'https://2e.aonprd.com/Archetypes.aspx?ID=264');
    await archetypeBaseNode.execute(Batch.of(state), stubContext);
    const result = await archetypeIntroductionNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<ArchetypeOutput>(state.output);
    assert.ok(typeof out.introduction === 'string', 'introduction should be a string');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Archetypes.aspx?ID=264');
    const result = await archetypeIntroductionNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });
});

// ─── extract:archetype-feats ──────────────────────────────────────────────────

describe('extract:archetype-feats — archetype-geomancer', () => {
  it('produces feats and feat_ids arrays', async () => {
    const state = await primeState('archetype-geomancer.html', 'https://2e.aonprd.com/Archetypes.aspx?ID=264');
    await archetypeBaseNode.execute(Batch.of(state), stubContext);
    await archetypeIntroductionNode.execute(Batch.of(state), stubContext);
    const result = await archetypeFeatsNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<ArchetypeOutput>(state.output);
    assert.ok(Array.isArray(out.feats), 'feats should be an array');
    assert.ok(Array.isArray(out.feat_ids), 'feat_ids should be an array');
  });

  it('first feat is the dedication feat (dedication_feat_id non-null)', async () => {
    const state = await primeState('archetype-geomancer.html', 'https://2e.aonprd.com/Archetypes.aspx?ID=264');
    await archetypeBaseNode.execute(Batch.of(state), stubContext);
    await archetypeIntroductionNode.execute(Batch.of(state), stubContext);
    await archetypeFeatsNode.execute(Batch.of(state), stubContext);
    const out = ParsedOutput.as<ArchetypeOutput>(state.output);
    assert.ok(out.feats.length > 0, 'should have at least one feat');
    assert.ok(out.dedication_feat_id !== null, 'dedication_feat_id should be set');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Archetypes.aspx?ID=264');
    const result = await archetypeFeatsNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });
});

// ─── Full pipeline ────────────────────────────────────────────────────────────

describe('full archetype pipeline — archetype-geomancer', () => {
  it('produces a complete ArchetypeOutput with all required fields', async () => {
    const out = await primeAndRunFull('archetype-geomancer.html', 'https://2e.aonprd.com/Archetypes.aspx?ID=264');

    assert.equal(out.name, 'Geomancer');
    assert.ok(typeof out.introduction === 'string', 'introduction missing');
    assert.ok(Array.isArray(out.feats) && out.feats.length > 0, 'feats missing');
    assert.ok(Array.isArray(out.feat_ids), 'feat_ids missing');
    assert.ok(out.dedication_feat_id !== null, 'dedication_feat_id missing');
    assert.ok(Array.isArray(out.sections), 'sections missing');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
    assert.ok(Array.isArray(out.links), 'links missing');
    assert.ok(typeof out.body_text === 'string', 'body_text missing');
  });

  it('each feat entry has name, feat_id, body_html', async () => {
    const out = await primeAndRunFull('archetype-geomancer.html', 'https://2e.aonprd.com/Archetypes.aspx?ID=264');
    const first = out.feats[0];
    assert.ok(first !== undefined, 'feats should have at least one entry');
    assert.ok(typeof first.name === 'string' && first.name.length > 0, 'feat.name missing');
    assert.ok(typeof first.body_html === 'string', 'feat.body_html missing');
  });
});
