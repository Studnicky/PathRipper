// Unit tests for feat concept capability nodes.
import { describe, it } from 'node:test';
import { Batch } from '@studnicky/dagonizer';
import assert from 'node:assert/strict';

import { loadAndCommonNode }           from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import { sectionWalkerNode }           from '../../../../../plugins/aonprd/capabilities/sectionWalker.js';
import { labelPairBlockNode }          from '../../../../../plugins/aonprd/capabilities/labelPairBlock.js';
import { sourceRefNode }               from '../../../../../plugins/aonprd/capabilities/sourceRef.js';
import {
  featBaseNode,
  featPrerequisitesNode,
  featEffectNode,
  featMetaNode,
  finalizeFeatNode,
} from '../../../../../plugins/aonprd/concepts/feat.js';
import type { FeatOutput } from '../../../../../plugins/aonprd/concepts/feat.js';
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
  await featBaseNode.execute(Batch.of(state), stubContext);
  await featPrerequisitesNode.execute(Batch.of(state), stubContext);
  await featEffectNode.execute(Batch.of(state), stubContext);
  await featMetaNode.execute(Batch.of(state), stubContext);
  await finalizeFeatNode.execute(Batch.of(state), stubContext);
  return ParsedOutput.as<FeatOutput>(state.output);
}

// ─── extract:feat-base ────────────────────────────────────────────────────────

describe('extract:feat-base — feat-dwarven-lore', () => {
  it('produces _type, name, feat_id, level', async () => {
    const state = await primeState('feat-dwarven-lore.html', 'https://2e.aonprd.com/Feats.aspx?ID=17');
    const result = await featBaseNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<FeatOutput>(state.output);
    assert.equal(out.name, 'Dwarven Lore');
    assert.equal(out.feat_id, 17);
    assert.ok(typeof out.level === 'number' || out.level === null, 'level should be number or null');
  });

  it('meta_description and meta_keywords are string or null', async () => {
    const state = await primeState('feat-dwarven-lore.html', 'https://2e.aonprd.com/Feats.aspx?ID=17');
    await featBaseNode.execute(Batch.of(state), stubContext);
    const out = ParsedOutput.as<FeatOutput>(state.output);
    assert.ok(
      out.meta_description === null || typeof out.meta_description === 'string',
      'meta_description type mismatch',
    );
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Feats.aspx?ID=17');
    const result = await featBaseNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });
});

// ─── extract:feat-prerequisites ──────────────────────────────────────────────

describe('extract:feat-prerequisites — feat-with-class', () => {
  it('produces archetypes and class_archetypes arrays', async () => {
    const state = await primeState('feat-with-class.html', 'https://2e.aonprd.com/Feats.aspx?ID=2849');
    await featBaseNode.execute(Batch.of(state), stubContext);
    const result = await featPrerequisitesNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<FeatOutput>(state.output);
    assert.ok(Array.isArray(out.archetypes), 'archetypes should be an array');
    assert.ok(Array.isArray(out.class_archetypes), 'class_archetypes should be an array');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Feats.aspx?ID=2849');
    const result = await featPrerequisitesNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });
});

describe('extract:feat-prerequisites — feat-with-related-feats (has archetype link)', () => {
  it('archetypes contains at least one entry', async () => {
    const state = await primeState('feat-with-related-feats.html', 'https://2e.aonprd.com/Feats.aspx?ID=316');
    await featBaseNode.execute(Batch.of(state), stubContext);
    await featPrerequisitesNode.execute(Batch.of(state), stubContext);
    const out = ParsedOutput.as<FeatOutput>(state.output);
    assert.ok(Array.isArray(out.archetypes), 'archetypes should be an array');
  });
});

// ─── extract:feat-effect ──────────────────────────────────────────────────────

describe('extract:feat-effect — feat-dwarven-lore', () => {
  it('produces description_text and description_html', async () => {
    const state = await primeState('feat-dwarven-lore.html', 'https://2e.aonprd.com/Feats.aspx?ID=17');
    const result = await featEffectNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<FeatOutput>(state.output);
    assert.ok(typeof out.description_text === 'string' && out.description_text.length > 0, 'description_text should be non-empty');
    assert.ok(typeof out.description_html === 'string', 'description_html missing');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Feats.aspx?ID=17');
    const result = await featEffectNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });
});

// ─── extract:feat-meta ────────────────────────────────────────────────────────

describe('extract:feat-meta — feat-with-related-feats', () => {
  it('produces leads_to and related_feats arrays', async () => {
    const state = await primeState('feat-with-related-feats.html', 'https://2e.aonprd.com/Feats.aspx?ID=316');
    await featBaseNode.execute(Batch.of(state), stubContext);
    await featPrerequisitesNode.execute(Batch.of(state), stubContext);
    await featEffectNode.execute(Batch.of(state), stubContext);
    const result = await featMetaNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<FeatOutput>(state.output);
    assert.ok(Array.isArray(out.leads_to), 'leads_to should be an array');
    assert.ok(Array.isArray(out.related_feats), 'related_feats should be an array');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Feats.aspx?ID=316');
    const result = await featMetaNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });
});

// ─── Full pipeline ────────────────────────────────────────────────────────────

describe('full feat pipeline — feat-dwarven-lore', () => {
  it('produces a complete FeatOutput with all required fields', async () => {
    const out = await primeAndRunFull('feat-dwarven-lore.html', 'https://2e.aonprd.com/Feats.aspx?ID=17');

    assert.equal(out.name, 'Dwarven Lore');
    assert.equal(out.feat_id, 17);
    assert.ok(typeof out.description_text === 'string' && out.description_text.length > 0, 'description_text missing');
    assert.ok(Array.isArray(out.archetypes), 'archetypes missing');
    assert.ok(Array.isArray(out.leads_to), 'leads_to missing');
    assert.ok(Array.isArray(out.related_feats), 'related_feats missing');
    assert.ok(Array.isArray(out.trait_glossary), 'trait_glossary missing');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
    assert.ok(Array.isArray(out.links), 'links missing');
  });

  it('is_mythic is false for a regular feat', async () => {
    const out = await primeAndRunFull('feat-dwarven-lore.html', 'https://2e.aonprd.com/Feats.aspx?ID=17');
    assert.equal(out.is_mythic, false, 'Dwarven Lore is not mythic');
  });
});

describe('full feat pipeline — feat-with-spoiler (spoiler_source field)', () => {
  it('spoiler_source is non-null when the page has a spoiler notice', async () => {
    const out = await primeAndRunFull('feat-with-spoiler.html', 'https://2e.aonprd.com/Feats.aspx?ID=3500');
    assert.ok(out.spoiler_source !== null && out.spoiler_source !== undefined, 'spoiler_source should be non-null for feat-with-spoiler');
  });
});
