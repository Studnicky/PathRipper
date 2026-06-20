// Unit tests for subclass-feature concept capability nodes.
// Uses five fixtures: bloodline (modern layout), mystery (modern + spell list),
// patron (legacy layout), druidic-order (modern), and research-field (modern).
import { describe, it } from 'node:test';
import { Batch } from '@studnicky/dagonizer';
import assert from 'node:assert/strict';

import { loadAndCommonNode }           from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import { sectionWalkerNode }           from '../../../../../plugins/aonprd/capabilities/sectionWalker.js';
import { labelPairBlockNode }          from '../../../../../plugins/aonprd/capabilities/labelPairBlock.js';
import { sourceRefNode }               from '../../../../../plugins/aonprd/capabilities/sourceRef.js';
import {
  subclassFeatureBaseNode,
  subclassFeatureFieldsNode,
  subclassFeatureSpellsNode,
  subclassFeatureFeaturesNode,
  finalizeSubclassFeatureNode,
} from '../../../../../plugins/aonprd/concepts/subclass-feature/index.js';
import type { SubclassFeatureOutput } from '../../../../../plugins/aonprd/concepts/subclass-feature/index.js';
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
  await subclassFeatureBaseNode.execute(Batch.of(state), stubContext);
  await subclassFeatureFieldsNode.execute(Batch.of(state), stubContext);
  await subclassFeatureSpellsNode.execute(Batch.of(state), stubContext);
  await subclassFeatureFeaturesNode.execute(Batch.of(state), stubContext);
  await finalizeSubclassFeatureNode.execute(Batch.of(state), stubContext);
  return ParsedOutput.as<SubclassFeatureOutput>(state.output);
}

// ─── extract:subclass-feature-base ───────────────────────────────────────────

describe('extract:subclass-feature-base — bloodline-aberrant', () => {
  it('produces _type, name, subclass_family, parent_class', async () => {
    const state = await primeState('subclass-feature-bloodline-aberrant.html', 'https://2e.aonprd.com/Bloodlines.aspx?ID=1');
    const result = await subclassFeatureBaseNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<SubclassFeatureOutput>(state.output);
    assert.equal(out.subclass_family, 'bloodline');
    assert.equal(out.parent_class, 'sorcerer');
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name should be non-empty');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Bloodlines.aspx?ID=1');
    const result = await subclassFeatureBaseNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });
});

describe('extract:subclass-feature-base — druidic-order-storm', () => {
  it('subclass_family is "druidic-order" and parent_class is "druid"', async () => {
    const state = await primeState('subclass-feature-druidic-order-storm.html', 'https://2e.aonprd.com/DruidicOrders.aspx?ID=4');
    await subclassFeatureBaseNode.execute(Batch.of(state), stubContext);
    const out = ParsedOutput.as<SubclassFeatureOutput>(state.output);
    assert.equal(out.subclass_family, 'druidic-order');
    assert.equal(out.parent_class, 'druid');
  });
});

describe('extract:subclass-feature-base — mystery-life', () => {
  it('subclass_family is "mystery" and parent_class is "oracle"', async () => {
    const state = await primeState('subclass-feature-mystery-life.html', 'https://2e.aonprd.com/Mysteries.aspx?ID=7');
    await subclassFeatureBaseNode.execute(Batch.of(state), stubContext);
    const out = ParsedOutput.as<SubclassFeatureOutput>(state.output);
    assert.equal(out.subclass_family, 'mystery');
    assert.equal(out.parent_class, 'oracle');
  });
});

// ─── extract:subclass-feature-spells ─────────────────────────────────────────

describe('extract:subclass-feature-spells — mystery-life (has Revelation Spells section)', () => {
  it('granted_spells is non-empty', async () => {
    const state = await primeState('subclass-feature-mystery-life.html', 'https://2e.aonprd.com/Mysteries.aspx?ID=7');
    await subclassFeatureBaseNode.execute(Batch.of(state), stubContext);
    const result = await subclassFeatureSpellsNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<Partial<SubclassFeatureOutput>>(state.output);
    assert.ok(Array.isArray(out.granted_spells), 'granted_spells should be an array');
    assert.ok((out.granted_spells?.length ?? 0) > 0, 'mystery-life should have granted spells');
  });

  it('spell groups have rank and spells arrays', async () => {
    const state = await primeState('subclass-feature-mystery-life.html', 'https://2e.aonprd.com/Mysteries.aspx?ID=7');
    await subclassFeatureBaseNode.execute(Batch.of(state), stubContext);
    await subclassFeatureSpellsNode.execute(Batch.of(state), stubContext);
    const out = ParsedOutput.as<Partial<SubclassFeatureOutput>>(state.output);
    const first = out.granted_spells?.[0];
    assert.ok(first !== undefined, 'should have at least one spell group');
    assert.ok(typeof first.rank === 'string', 'spell group.rank missing');
    assert.ok(Array.isArray(first.spells), 'spell group.spells missing');
  });
});

describe('extract:subclass-feature-spells — patron-mosquito-witch (legacy layout)', () => {
  it('granted_spells is an array (may be empty for legacy patron layout)', async () => {
    const state = await primeState('subclass-feature-patron-mosquito-witch.html', 'https://2e.aonprd.com/Patrons.aspx?ID=1');
    await subclassFeatureBaseNode.execute(Batch.of(state), stubContext);
    const result = await subclassFeatureSpellsNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<Partial<SubclassFeatureOutput>>(state.output);
    assert.ok(Array.isArray(out.granted_spells), 'granted_spells should be an array');
  });
});

// ─── extract:subclass-feature-features ───────────────────────────────────────

describe('extract:subclass-feature-features — bloodline-aberrant', () => {
  it('granted_features is an array', async () => {
    const state = await primeState('subclass-feature-bloodline-aberrant.html', 'https://2e.aonprd.com/Bloodlines.aspx?ID=1');
    await subclassFeatureBaseNode.execute(Batch.of(state), stubContext);
    await subclassFeatureFieldsNode.execute(Batch.of(state), stubContext);
    await subclassFeatureSpellsNode.execute(Batch.of(state), stubContext);
    const result = await subclassFeatureFeaturesNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<Partial<SubclassFeatureOutput>>(state.output);
    assert.ok(Array.isArray(out.granted_features), 'granted_features should be an array');
  });
});

// ─── Full pipeline ────────────────────────────────────────────────────────────

describe('full subclass-feature pipeline — bloodline-aberrant', () => {
  it('produces a complete SubclassFeatureOutput', async () => {
    const out = await primeAndRunFull('subclass-feature-bloodline-aberrant.html', 'https://2e.aonprd.com/Bloodlines.aspx?ID=1');

    assert.equal(out.subclass_family, 'bloodline');
    assert.equal(out.parent_class, 'sorcerer');
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name missing');
    assert.ok(typeof out.feature_fields === 'object', 'feature_fields missing');
    assert.ok(Array.isArray(out.granted_spells), 'granted_spells missing');
    assert.ok(Array.isArray(out.granted_features), 'granted_features missing');
    assert.ok(Array.isArray(out.sections), 'sections missing');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
    assert.ok(Array.isArray(out.links), 'links missing');
    assert.ok(typeof out.body_text === 'string', 'body_text missing');
  });
});

describe('full subclass-feature pipeline — research-field-toxicologist', () => {
  it('subclass_family is "research-field" and parent_class is "alchemist"', async () => {
    const out = await primeAndRunFull('subclass-feature-research-field-toxicologist.html', 'https://2e.aonprd.com/ResearchFields.aspx?ID=4');
    assert.equal(out.subclass_family, 'research-field');
    assert.equal(out.parent_class, 'alchemist');
  });
});

describe('full subclass-feature pipeline — ikon-starshot', () => {
  it('subclass_family is "ikon" and parent_class is "exemplar"', async () => {
    const out = await primeAndRunFull('subclass-feature-ikon-starshot.html', 'https://2e.aonprd.com/Ikons.aspx?ID=1');
    assert.equal(out.subclass_family, 'ikon');
    assert.equal(out.parent_class, 'exemplar');
  });
});
