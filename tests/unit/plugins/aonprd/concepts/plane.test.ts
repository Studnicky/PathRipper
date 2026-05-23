// Unit tests for plane concept capability nodes (Phase 6.4).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { loadAndCommonNode }           from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import { sectionWalkerNode }           from '../../../../../plugins/aonprd/capabilities/sectionWalker.js';
import { labelPairBlockNode }          from '../../../../../plugins/aonprd/capabilities/labelPairBlock.js';
import { sourceRefNode }               from '../../../../../plugins/aonprd/capabilities/sourceRef.js';
import {
  planeBaseNode,
  planeCharacteristicsNode,
  finalizePlaneNode,
} from '../../../../../plugins/aonprd/concepts/plane.js';
import type { PlaneOutput } from '../../../../../plugins/aonprd/concepts/plane.js';
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
  await planeBaseNode.execute(state, stubContext);
  await planeCharacteristicsNode.execute(state, stubContext);
  await finalizePlaneNode.execute(state, stubContext);
  return state.output as PlaneOutput;
}

describe('extract:plane-base — plane-earth', () => {
  it('produces _type, name, plane_id, divinities, native_inhabitants', async () => {
    const state = await primeState('plane-earth.html', 'https://2e.aonprd.com/Planes.aspx?ID=3');
    const r = await planeBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as PlaneOutput;
    assert.equal(out._type, 'plane');
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name should be non-empty');
    assert.equal(out.plane_id, 3);
    assert.ok(Array.isArray(out.divinities), 'divinities should be an array');
    assert.ok(Array.isArray(out.native_inhabitants), 'native_inhabitants should be an array');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Planes.aspx?ID=3');
    const r = await planeBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('extract:plane-characteristics — plane-earth', () => {
  it('produces category and aspect fields', async () => {
    const state = await primeState('plane-earth.html', 'https://2e.aonprd.com/Planes.aspx?ID=3');
    await planeBaseNode.execute(state, stubContext);
    const r = await planeCharacteristicsNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as PlaneOutput;
    // category may be null or a string; just verify the field exists
    assert.ok('category' in out, 'category field missing');
    assert.ok('aspect' in out, 'aspect field missing');
  });

  it('error path — returns error when prerequisites missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Planes.aspx?ID=3');
    const r = await planeCharacteristicsNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('finalize:plane — plane-earth', () => {
  it('produces description_text, sections, raw_fields, links', async () => {
    const state = await primeState('plane-earth.html', 'https://2e.aonprd.com/Planes.aspx?ID=3');
    await planeBaseNode.execute(state, stubContext);
    await planeCharacteristicsNode.execute(state, stubContext);
    const r = await finalizePlaneNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as PlaneOutput;
    assert.ok(typeof out.description_text === 'string', 'description_text missing');
    assert.ok(Array.isArray(out.sections), 'sections missing');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
    assert.ok(Array.isArray(out.links), 'links missing');
    assert.ok(typeof out.body_html === 'string', 'body_html missing');
  });

  it('error path — soft-fails to success when prerequisites missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Planes.aspx?ID=3');
    const r = await finalizePlaneNode.execute(state, stubContext);
    assert.equal(r.output, 'success');
  });
});

describe('full plane pipeline — plane-earth', () => {
  it('produces complete PlaneOutput with all required fields', async () => {
    const out = await primeAndRunFull('plane-earth.html', 'https://2e.aonprd.com/Planes.aspx?ID=3');
    assert.equal(out._type, 'plane');
    assert.equal(out.plane_id, 3);
    assert.ok(Array.isArray(out.divinities), 'divinities missing');
    assert.ok(Array.isArray(out.native_inhabitants), 'native_inhabitants missing');
    assert.ok('category' in out, 'category missing');
    assert.ok(typeof out.body_text === 'string', 'body_text missing');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
  });
});

describe('full plane pipeline — plane-outer-rifts', () => {
  it('produces valid PlaneOutput', async () => {
    const out = await primeAndRunFull('plane-outer-rifts.html', 'https://2e.aonprd.com/Planes.aspx?ID=15');
    assert.equal(out._type, 'plane');
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name missing');
  });
});
