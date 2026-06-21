// Unit tests for extract:label-pair-block capability.
// Proves byte-equivalence with harvestFields() from common.ts.
import { describe, it } from 'node:test';
import { Batch } from '@studnicky/dagonizer';
import assert from 'node:assert/strict';
import { labelPairBlockNode }  from '../../../../../plugins/aonprd/capabilities/labelPairBlock.js';
import { loadAndCommonNode }   from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import type { HarvestedField, CheerioNode } from '../../../../../plugins/aonprd/common.js';
import { harvestFields, splitOnHr }         from '../../../../../plugins/aonprd/common.js';
import { loadFixture, makeState, stubContext } from '../nodes/helpers.js';

async function primeAndRun(fixtureName: string, url: string) {
  const html  = await loadFixture(fixtureName);
  const state = makeState(html, url);
  const result1    = await loadAndCommonNode.execute(Batch.of(state), stubContext);
  assert.ok(result1.has('success'), `loadAndCommon failed for ${fixtureName}`);
  const result2 = await labelPairBlockNode.execute(Batch.of(state), stubContext);
  assert.ok(result2.has('success'), `labelPairBlock failed for ${fixtureName}`);
  return state;
}

describe('extract:label-pair-block — spell-abyssal-plague', () => {
  it('matches harvestFields() directly on the same HTML', async () => {
    const fixtureName = 'spell-abyssal-plague.html';
    const url         = 'https://2e.aonprd.com/Spells.aspx?ID=1';
    const state = await primeAndRun(fixtureName, url);

    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    assert.ok(target !== undefined);
    const { fields: expected, field_map: expectedMap } = harvestFields(splitOnHr(target.html() ?? '').head);

    const fields    = state.getMetadata<HarvestedField[]>('fields');
    const field_map = state.getMetadata<Record<string, string>>('field_map');

    assert.deepEqual(fields, expected);
    assert.deepEqual(field_map, expectedMap);
  });

  it('produces at least one field with a non-empty label', async () => {
    const state  = await primeAndRun('spell-abyssal-plague.html', 'https://2e.aonprd.com/Spells.aspx?ID=1');
    const fields = state.getMetadata<HarvestedField[]>('fields');
    assert.ok(Array.isArray(fields) && fields.length > 0);
    assert.ok(fields[0]!.label !== '');
  });
});

describe('extract:label-pair-block — feat-dwarven-lore', () => {
  it('matches harvestFields() directly on the same HTML', async () => {
    const fixtureName = 'feat-dwarven-lore.html';
    const url         = 'https://2e.aonprd.com/Feats.aspx?ID=1';
    const state = await primeAndRun(fixtureName, url);

    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    assert.ok(target !== undefined);
    const { fields: expected, field_map: expectedMap } = harvestFields(splitOnHr(target.html() ?? '').head);

    const fields    = state.getMetadata<HarvestedField[]>('fields');
    const field_map = state.getMetadata<Record<string, string>>('field_map');

    assert.deepEqual(fields, expected);
    assert.deepEqual(field_map, expectedMap);
  });
});

describe('extract:label-pair-block — monster-phantasmal-minion', () => {
  it('matches harvestFields() directly on the same HTML', async () => {
    const fixtureName = 'monster-phantasmal-minion.html';
    const url         = 'https://2e.aonprd.com/Monsters.aspx?ID=1';
    const state = await primeAndRun(fixtureName, url);

    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    assert.ok(target !== undefined);
    const { fields: expected, field_map: expectedMap } = harvestFields(splitOnHr(target.html() ?? '').head);

    const fields    = state.getMetadata<HarvestedField[]>('fields');
    const field_map = state.getMetadata<Record<string, string>>('field_map');

    assert.deepEqual(fields, expected);
    assert.deepEqual(field_map, expectedMap);
  });
});

describe('extract:label-pair-block — open-world soft-fail', () => {
  it('outputs success and writes nothing when required metadata is missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Spells.aspx?ID=1');
    const result = await labelPairBlockNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));
    assert.equal(state.getMetadata('fields'), undefined);
    assert.equal(state.getMetadata('field_map'), undefined);
  });
});
