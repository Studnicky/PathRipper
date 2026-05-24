// Unit tests for set-relic concept capability nodes (Phase 6.4).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { loadAndCommonNode }           from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import { sectionWalkerNode }           from '../../../../../plugins/aonprd/capabilities/sectionWalker.js';
import { labelPairBlockNode }          from '../../../../../plugins/aonprd/capabilities/labelPairBlock.js';
import { sourceRefNode }               from '../../../../../plugins/aonprd/capabilities/sourceRef.js';
import {
  setRelicBaseNode,
  setRelicComponentsNode,
  finalizeSetRelicNode,
} from '../../../../../plugins/aonprd/concepts/set-relic.js';
import type { SetRelicOutput } from '../../../../../plugins/aonprd/concepts/set-relic.js';
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
  await setRelicBaseNode.execute(state, stubContext);
  await setRelicComponentsNode.execute(state, stubContext);
  await finalizeSetRelicNode.execute(state, stubContext);
  return state.output as SetRelicOutput;
}

describe('extract:set-relic-base — set-relic-duelists-blazon', () => {
  it('produces _type, name, set_relic_id', async () => {
    const state = await primeState('set-relic-duelists-blazon.html', 'https://2e.aonprd.com/SetRelics.aspx?ID=1');
    const r = await setRelicBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as SetRelicOutput;
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name should be non-empty');
    assert.equal(out.set_relic_id, 1);
  });

  it('captures source and traits', async () => {
    const state = await primeState('set-relic-duelists-blazon.html', 'https://2e.aonprd.com/SetRelics.aspx?ID=1');
    await setRelicBaseNode.execute(state, stubContext);
    const out = state.output as SetRelicOutput;
    assert.ok(out.source !== undefined, 'source missing');
    assert.ok(Array.isArray(out.traits), 'traits should be array');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/SetRelics.aspx?ID=1');
    const r = await setRelicBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('extract:set-relic-components — set-relic-duelists-blazon', () => {
  it('produces aspects, components, gifts, features', async () => {
    const state = await primeState('set-relic-duelists-blazon.html', 'https://2e.aonprd.com/SetRelics.aspx?ID=1');
    await setRelicBaseNode.execute(state, stubContext);
    const r = await setRelicComponentsNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as SetRelicOutput;
    assert.ok(Array.isArray(out.aspects), 'aspects should be array');
    assert.ok(Array.isArray(out.components), 'components should be array');
    assert.ok(Array.isArray(out.gifts), 'gifts should be array');
    assert.ok(Array.isArray(out.features), 'features should be array');
  });

  it('error path — returns error when prerequisites missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/SetRelics.aspx?ID=1');
    const r = await setRelicComponentsNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('finalize:set-relic — set-relic-duelists-blazon', () => {
  it('produces sections, raw_fields, body fields', async () => {
    const state = await primeState('set-relic-duelists-blazon.html', 'https://2e.aonprd.com/SetRelics.aspx?ID=1');
    await setRelicBaseNode.execute(state, stubContext);
    await setRelicComponentsNode.execute(state, stubContext);
    const r = await finalizeSetRelicNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as SetRelicOutput;
    assert.ok(Array.isArray(out.sections), 'sections missing');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
    assert.ok(typeof out.body_text === 'string', 'body_text missing');
  });

  it('error path — soft-fails to success when prerequisites missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/SetRelics.aspx?ID=1');
    const r = await finalizeSetRelicNode.execute(state, stubContext);
    assert.equal(r.output, 'success');
  });
});

describe('full set-relic pipeline — set-relic-duelists-blazon', () => {
  it('produces complete SetRelicOutput', async () => {
    const out = await primeAndRunFull('set-relic-duelists-blazon.html', 'https://2e.aonprd.com/SetRelics.aspx?ID=1');
    assert.equal(out.set_relic_id, 1);
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name missing');
    assert.ok(Array.isArray(out.aspects), 'aspects missing');
    assert.ok(Array.isArray(out.gifts), 'gifts missing');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
  });
});
