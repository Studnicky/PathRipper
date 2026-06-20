// Unit tests for class-kit concept capability nodes.
import { describe, it } from 'node:test';
import { Batch } from '@studnicky/dagonizer';
import assert from 'node:assert/strict';

import { loadAndCommonNode }           from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import { sectionWalkerNode }           from '../../../../../plugins/aonprd/capabilities/sectionWalker.js';
import { labelPairBlockNode }          from '../../../../../plugins/aonprd/capabilities/labelPairBlock.js';
import { sourceRefNode }               from '../../../../../plugins/aonprd/capabilities/sourceRef.js';
import {
  classKitBaseNode,
  classKitContentsNode,
  finalizeClassKitNode,
} from '../../../../../plugins/aonprd/concepts/class-kit.js';
import type { ClassKitOutput } from '../../../../../plugins/aonprd/concepts/class-kit.js';
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
  await classKitBaseNode.execute(Batch.of(state), stubContext);
  await classKitContentsNode.execute(Batch.of(state), stubContext);
  await finalizeClassKitNode.execute(Batch.of(state), stubContext);
  return ParsedOutput.as<ClassKitOutput>(state.output);
}

// ─── extract:class-kit-base ───────────────────────────────────────────────────

describe('extract:class-kit-base — class-kit-alchemist', () => {
  it('produces _type, name, class_kit_id', async () => {
    const state = await primeState('class-kit-alchemist.html', 'https://2e.aonprd.com/ClassKits.aspx?ID=1');
    const result = await classKitBaseNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<ClassKitOutput>(state.output);
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name should be non-empty');
    assert.equal(out.class_kit_id, 1);
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/ClassKits.aspx?ID=1');
    const result = await classKitBaseNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });
});

// ─── extract:class-kit-contents ──────────────────────────────────────────────

describe('extract:class-kit-contents — class-kit-alchemist', () => {
  it('produces armor, weapons, gear, options as arrays', async () => {
    const state = await primeState('class-kit-alchemist.html', 'https://2e.aonprd.com/ClassKits.aspx?ID=1');
    const result = await classKitContentsNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<Partial<ClassKitOutput>>(state.output);
    assert.ok(Array.isArray(out.armor), 'armor should be an array');
    assert.ok(Array.isArray(out.weapons), 'weapons should be an array');
    assert.ok(Array.isArray(out.gear), 'gear should be an array');
    assert.ok(Array.isArray(out.options), 'options should be an array');
  });

  it('gear contains ClassKitItem entries with name and kind', async () => {
    const state = await primeState('class-kit-alchemist.html', 'https://2e.aonprd.com/ClassKits.aspx?ID=1');
    await classKitContentsNode.execute(Batch.of(state), stubContext);
    const out = ParsedOutput.as<Partial<ClassKitOutput>>(state.output);
    if ((out.gear?.length ?? 0) > 0) {
      const first = out.gear![0]!;
      assert.ok(typeof first.name === 'string' && first.name.length > 0, 'gear item name missing');
      assert.ok(typeof first.kind === 'string', 'gear item kind missing');
    }
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/ClassKits.aspx?ID=1');
    const result = await classKitContentsNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });
});

// ─── Full pipeline ────────────────────────────────────────────────────────────

describe('full class-kit pipeline — class-kit-alchemist', () => {
  it('produces a complete ClassKitOutput with all required fields', async () => {
    const out = await primeAndRunFull('class-kit-alchemist.html', 'https://2e.aonprd.com/ClassKits.aspx?ID=1');

    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name missing');
    assert.ok(Array.isArray(out.armor), 'armor missing');
    assert.ok(Array.isArray(out.weapons), 'weapons missing');
    assert.ok(Array.isArray(out.gear), 'gear missing');
    assert.ok(Array.isArray(out.options), 'options missing');
    assert.ok(Array.isArray(out.sections), 'sections missing');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
  });

  it('price is a string or null', async () => {
    const out = await primeAndRunFull('class-kit-alchemist.html', 'https://2e.aonprd.com/ClassKits.aspx?ID=1');
    assert.ok(out.price === null || typeof out.price === 'string', 'price should be string or null');
  });
});
