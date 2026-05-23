// Unit tests for extract:source-ref capability.
// Proves byte-equivalence with extractSources() from common.ts (Wave 5 source of truth).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { sourceRefNode }       from '../../../../../plugins/aonprd/capabilities/sourceRef.js';
import { loadAndCommonNode }   from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import type { SourceRef, CheerioNode } from '../../../../../plugins/aonprd/common.js';
import { extractSources }               from '../../../../../plugins/aonprd/common.js';
import { loadFixture, makeState, stubContext } from '../nodes/helpers.js';

async function primeAndRun(fixtureName: string, url: string) {
  const html  = await loadFixture(fixtureName);
  const state = makeState(html, url);
  const r1    = await loadAndCommonNode.execute(state, stubContext);
  assert.equal(r1.output, 'success', `loadAndCommon failed for ${fixtureName}`);
  const r2 = await sourceRefNode.execute(state, stubContext);
  assert.equal(r2.output, 'success', `sourceRef failed for ${fixtureName}`);
  return state;
}

describe('extract:source-ref — spell-abyssal-plague', () => {
  it('matches extractSources() directly on the same HTML', async () => {
    const fixtureName = 'spell-abyssal-plague.html';
    const url         = 'https://2e.aonprd.com/Spells.aspx?ID=1';
    const state = await primeAndRun(fixtureName, url);

    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    assert.ok(target !== undefined);
    const expectedSources = extractSources(target);
    const expectedSource  = expectedSources[0] ?? { book: null, page: null, source_id: null, raw: '' };

    const sources = state.getMetadata<SourceRef[]>('sources');
    const source  = state.getMetadata<SourceRef>('source');

    assert.deepEqual(sources, expectedSources);
    assert.deepEqual(source, expectedSource);
  });

  it('source is first entry in sources array', async () => {
    const state   = await primeAndRun('spell-abyssal-plague.html', 'https://2e.aonprd.com/Spells.aspx?ID=1');
    const sources = state.getMetadata<SourceRef[]>('sources');
    const source  = state.getMetadata<SourceRef>('source');
    assert.ok(Array.isArray(sources) && sources.length > 0);
    assert.deepEqual(source, sources[0]);
  });
});

describe('extract:source-ref — language-common', () => {
  it('matches extractSources() directly on the same HTML', async () => {
    const fixtureName = 'language-common.html';
    const url         = 'https://2e.aonprd.com/Languages.aspx?ID=1';
    const state = await primeAndRun(fixtureName, url);

    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    assert.ok(target !== undefined);
    const expectedSources = extractSources(target);
    const expectedSource  = expectedSources[0] ?? { book: null, page: null, source_id: null, raw: '' };

    const sources = state.getMetadata<SourceRef[]>('sources');
    const source  = state.getMetadata<SourceRef>('source');

    assert.deepEqual(sources, expectedSources);
    assert.deepEqual(source, expectedSource);
  });
});

describe('extract:source-ref — weapon-longsword', () => {
  it('matches extractSources() directly on the same HTML', async () => {
    const fixtureName = 'weapon-longsword.html';
    const url         = 'https://2e.aonprd.com/Weapons.aspx?ID=1';
    const state = await primeAndRun(fixtureName, url);

    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    assert.ok(target !== undefined);
    const expectedSources = extractSources(target);

    const sources = state.getMetadata<SourceRef[]>('sources');
    assert.deepEqual(sources, expectedSources);
  });
});

describe('extract:source-ref — open-world soft-fail', () => {
  it('outputs success and writes nothing when aonprdTarget metadata is missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Spells.aspx?ID=1');
    const r = await sourceRefNode.execute(state, stubContext);
    assert.equal(r.output, 'success');
    assert.equal(state.getMetadata('source'), undefined);
    assert.equal(state.getMetadata('sources'), undefined);
  });
});
