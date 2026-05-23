// Unit tests for class concept capability nodes (Phase 6.4).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { loadAndCommonNode }           from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import { sectionWalkerNode }           from '../../../../../plugins/aonprd/capabilities/sectionWalker.js';
import { labelPairBlockNode }          from '../../../../../plugins/aonprd/capabilities/labelPairBlock.js';
import { sourceRefNode }               from '../../../../../plugins/aonprd/capabilities/sourceRef.js';
import {
  classBaseNode,
  classProgressionNode,
  classSubclassesNode,
  finalizeClassNode,
} from '../../../../../plugins/aonprd/concepts/class/concept.js';
import type { ClassOutput } from '../../../../../plugins/aonprd/concepts/class/types.js';
import { loadFixture, makeState, stubContext } from '../nodes/helpers.js';

async function primeState(fixtureName: string, url: string) {
  const html  = await loadFixture(fixtureName);
  const state = makeState(html, url);
  await loadAndCommonNode.execute(state, stubContext);
  await labelPairBlockNode.execute(state, stubContext);
  await sectionWalkerNode.execute(state, stubContext);
  await sourceRefNode.execute(state, stubContext);
  return state;
}

async function primeAndRunFull(fixtureName: string, url: string) {
  const state = await primeState(fixtureName, url);
  await classBaseNode.execute(state, stubContext);
  await classProgressionNode.execute(state, stubContext);
  await classSubclassesNode.execute(state, stubContext);
  await finalizeClassNode.execute(state, stubContext);
  return state.output as ClassOutput;
}

// ─── extract:class-base ───────────────────────────────────────────────────────

describe('extract:class-base — class-sorcerer', () => {
  it('produces _type, name, class_id', async () => {
    const state = await primeState('class-sorcerer.html', 'https://2e.aonprd.com/Classes.aspx?ID=11');
    const r = await classBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as ClassOutput;
    assert.equal(out._type, 'class');
    assert.equal(out.name, 'Sorcerer');
    assert.equal(out.class_id, 11);
  });

  it('hp_per_level is a positive number', async () => {
    const state = await primeState('class-sorcerer.html', 'https://2e.aonprd.com/Classes.aspx?ID=11');
    await classBaseNode.execute(state, stubContext);
    const out = state.output as ClassOutput;
    assert.ok(typeof out.hp_per_level === 'number' && out.hp_per_level > 0, 'hp_per_level should be a positive number');
  });

  it('key_attribute is non-null', async () => {
    const state = await primeState('class-sorcerer.html', 'https://2e.aonprd.com/Classes.aspx?ID=11');
    await classBaseNode.execute(state, stubContext);
    const out = state.output as ClassOutput;
    assert.ok(out.key_attribute !== null, 'key_attribute should be non-null for Sorcerer');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Classes.aspx?ID=11');
    const r = await classBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

// ─── extract:class-progression ───────────────────────────────────────────────

describe('extract:class-progression — class-sorcerer', () => {
  it('produces a progression array (may be empty if fixture uses table format)', async () => {
    const state = await primeState('class-sorcerer.html', 'https://2e.aonprd.com/Classes.aspx?ID=11');
    const r = await classProgressionNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as Partial<ClassOutput>;
    assert.ok(Array.isArray(out.progression), 'progression should be an array');
    // Some fixtures use table-format class features that parseClassFeaturesProgression
    // may return empty — this is correct Wave 5 behaviour for those pages.
  });

  it('progression entries (when present) have level and features arrays', async () => {
    const state = await primeState('class-sorcerer.html', 'https://2e.aonprd.com/Classes.aspx?ID=11');
    await classProgressionNode.execute(state, stubContext);
    const out = state.output as Partial<ClassOutput>;
    // If progression is non-empty, validate the shape of entries.
    if ((out.progression?.length ?? 0) > 0) {
      const first = out.progression![0]!;
      assert.ok(typeof first.level === 'number', 'progression entry.level should be a number');
      assert.ok(Array.isArray(first.features), 'progression entry.features should be an array');
    }
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Classes.aspx?ID=11');
    const r = await classProgressionNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

// ─── extract:class-subclasses ─────────────────────────────────────────────────

describe('extract:class-subclasses — class-sorcerer', () => {
  it('produces subclasses and subclass_features arrays', async () => {
    const state = await primeState('class-sorcerer.html', 'https://2e.aonprd.com/Classes.aspx?ID=11');
    const r = await classSubclassesNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as Partial<ClassOutput>;
    assert.ok(Array.isArray(out.subclasses), 'subclasses should be an array');
    assert.ok(Array.isArray(out.subclass_features), 'subclass_features should be an array');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Classes.aspx?ID=11');
    const r = await classSubclassesNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

// ─── Full pipeline ────────────────────────────────────────────────────────────

describe('full class pipeline — class-sorcerer', () => {
  it('produces a complete ClassOutput with all required fields', async () => {
    const out = await primeAndRunFull('class-sorcerer.html', 'https://2e.aonprd.com/Classes.aspx?ID=11');

    assert.equal(out._type, 'class');
    assert.equal(out.name, 'Sorcerer');
    assert.ok(typeof out.hp_per_level === 'number', 'hp_per_level missing');
    assert.ok(Array.isArray(out.progression), 'progression missing');
    assert.ok(Array.isArray(out.subclasses), 'subclasses missing');
    assert.ok(Array.isArray(out.subclass_features), 'subclass_features missing');
    assert.ok(typeof out.initial_proficiencies === 'object', 'initial_proficiencies missing');
    assert.ok(Array.isArray(out.sections), 'sections missing');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
    assert.ok(Array.isArray(out.links), 'links missing');
    assert.ok(typeof out.body_text === 'string', 'body_text missing');
  });

  it('raw_fields does not contain claimed keys (Class Features, Hit Points)', async () => {
    const out = await primeAndRunFull('class-sorcerer.html', 'https://2e.aonprd.com/Classes.aspx?ID=11');
    const claimed = new Set(['class features', 'hit points', 'key attribute', 'key ability', 'class dc']);
    for (const key of Object.keys(out.raw_fields)) {
      assert.ok(!claimed.has(key.toLowerCase()), `claimed key "${key}" should be absent from raw_fields`);
    }
  });
});
