// Unit tests for aonprd:load-and-common node.
import { describe, it } from 'node:test';
import { Batch } from '@studnicky/dagonizer';
import assert from 'node:assert/strict';

import { loadAndCommonNode }      from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import type { CommonExtraction }  from '../../../../../plugins/aonprd/common.js';
import { loadFixture, makeState, stubContext } from './helpers.js';

describe('aonprd:load-and-common node', () => {
  it('outputs success and stashes cheerio + common + target on valid HTML', async () => {
    const html  = await loadFixture('spell-abyssal-plague.html');
    const state = makeState(html, 'https://2e.aonprd.com/Spells.aspx?ID=1');
    const result = await loadAndCommonNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));
    assert.ok(state.getMetadata('aonprdCheerio') !== undefined, 'cheerio should be stashed');
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    assert.ok(common !== undefined, 'common should be stashed');
    assert.equal(common?.url, 'https://2e.aonprd.com/Spells.aspx?ID=1');
    assert.ok(state.getMetadata('aonprdTarget') !== undefined, 'target span should be stashed');
  });

  it('outputs error when HTML has no content span', async () => {
    const state = makeState('<html><body>nothing</body></html>', 'https://2e.aonprd.com/X.aspx?ID=1');
    const result = await loadAndCommonNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });

  it('outputs error when page.html is undefined', async () => {
    const state = makeState('', 'https://2e.aonprd.com/X.aspx?ID=1');
    state.page = { targetId: 'aonprd', title: '', url: 'https://2e.aonprd.com/X.aspx?ID=1' };
    const result = await loadAndCommonNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });

  it('stashes monster-page span as target for monster pages', async () => {
    const html  = await loadFixture('monster-phantasmal-minion.html');
    const state = makeState(html, 'https://2e.aonprd.com/Monsters.aspx?ID=1');
    const result = await loadAndCommonNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));
    assert.ok(state.getMetadata('aonprdTarget') !== undefined);
  });
});
