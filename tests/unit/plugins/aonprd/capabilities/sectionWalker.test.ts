// Unit tests for extract:section-walker capability.
// Proves byte-equivalence with harvestSections() from common.ts (Wave 5 source of truth).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { CheerioAPI } from 'cheerio';

import { sectionWalkerNode }   from '../../../../../plugins/aonprd/capabilities/sectionWalker.js';
import { loadAndCommonNode }   from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import type { Section, CheerioNode } from '../../../../../plugins/aonprd/common.js';
import { harvestSections }           from '../../../../../plugins/aonprd/common.js';
import { loadFixture, makeState, stubContext } from '../nodes/helpers.js';

async function primeAndRun(fixtureName: string, url: string) {
  const html  = await loadFixture(fixtureName);
  const state = makeState(html, url);
  const r1    = await loadAndCommonNode.execute(state, stubContext);
  assert.equal(r1.output, 'success', `loadAndCommon failed for ${fixtureName}`);
  const r2 = await sectionWalkerNode.execute(state, stubContext);
  assert.equal(r2.output, 'success', `sectionWalker failed for ${fixtureName}`);
  return state;
}

describe('extract:section-walker — spell-abyssal-plague', () => {
  it('matches harvestSections() directly on the same HTML', async () => {
    const fixtureName = 'spell-abyssal-plague.html';
    const url         = 'https://2e.aonprd.com/Spells.aspx?ID=1';
    const state = await primeAndRun(fixtureName, url);

    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    assert.ok($ !== undefined && target !== undefined);
    const expected = harvestSections($, target);

    const sections = state.getMetadata<Section[]>('sections');
    assert.deepEqual(sections, expected);
  });
});

describe('extract:section-walker — feat-hedge-prison', () => {
  it('matches harvestSections() directly on the same HTML', async () => {
    const fixtureName = 'feat-hedge-prison.html';
    const url         = 'https://2e.aonprd.com/Feats.aspx?ID=2';
    const state = await primeAndRun(fixtureName, url);

    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    assert.ok($ !== undefined && target !== undefined);
    const expected = harvestSections($, target);

    const sections = state.getMetadata<Section[]>('sections');
    assert.deepEqual(sections, expected);
  });
});

describe('extract:section-walker — monster-phantasmal-minion', () => {
  it('matches harvestSections() directly on the same HTML', async () => {
    const fixtureName = 'monster-phantasmal-minion.html';
    const url         = 'https://2e.aonprd.com/Monsters.aspx?ID=1';
    const state = await primeAndRun(fixtureName, url);

    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    assert.ok($ !== undefined && target !== undefined);
    const expected = harvestSections($, target);

    const sections = state.getMetadata<Section[]>('sections');
    assert.deepEqual(sections, expected);
  });
});

describe('extract:section-walker — open-world soft-fail', () => {
  it('outputs success and writes nothing when required metadata is missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Spells.aspx?ID=1');
    const r = await sectionWalkerNode.execute(state, stubContext);
    assert.equal(r.output, 'success');
    assert.equal(state.getMetadata('sections'), undefined);
  });
});
