// Unit tests for source concept capability nodes.
import { describe, it } from 'node:test';
import { Batch } from '@studnicky/dagonizer';
import assert from 'node:assert/strict';

import { loadAndCommonNode }  from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import {
  sourceBaseNode,
  sourceMetadataNode,
  sourceRelatedNode,
  finalizeSourceNode,
} from '../../../../../plugins/aonprd/concepts/source.js';
import type { SourceOutput } from '../../../../../plugins/aonprd/concepts/source.js';
import { loadFixture, makeState, stubContext } from '../nodes/helpers.js';
import { ParsedOutput } from '../../../../helpers/ParsedOutput.js';

const FIXTURE = 'source-core-rulebook.html';
const URL     = 'https://2e.aonprd.com/Sources.aspx?ID=1';

async function primeState() {
  const html  = await loadFixture(FIXTURE);
  const state = makeState(html, URL);
  await loadAndCommonNode.execute(Batch.of(state), stubContext);
  return state;
}

async function primeAndRunFull() {
  const state = await primeState();
  await sourceBaseNode.execute(Batch.of(state), stubContext);
  await sourceMetadataNode.execute(Batch.of(state), stubContext);
  await sourceRelatedNode.execute(Batch.of(state), stubContext);
  await finalizeSourceNode.execute(Batch.of(state), stubContext);
  return ParsedOutput.as<SourceOutput>(state.output);
}

describe('extract:source-base — source-core-rulebook', () => {
  it('produces _type, name, source_id', async () => {
    const state = await primeState();
    const result = await sourceBaseNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<SourceOutput>(state.output);
    assert.equal(out.name, 'Core Rulebook');
    assert.equal(out.source_id, 1);
    assert.equal(out.url, URL);
    assert.ok(Array.isArray(out.traits), 'traits is array');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', URL);
    const result = await sourceBaseNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });
});

describe('extract:source-metadata — source-core-rulebook', () => {
  it('captures product_page, release_date, product_line, latest_errata', async () => {
    const state = await primeState();
    await sourceBaseNode.execute(Batch.of(state), stubContext);
    const result = await sourceMetadataNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<SourceOutput>(state.output);
    assert.equal(out.product_page, 'https://store.paizo.com/pathfinder-core-rulebook/');
    assert.equal(out.release_date, '8/1/2019');
    assert.equal(out.product_line, 'Rulebooks');
    assert.equal(out.latest_errata, '4.0 - 1/3/2023');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', URL);
    const result = await sourceMetadataNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });
});

describe('extract:source-related — source-core-rulebook', () => {
  it('catalogues linked entities from the page', async () => {
    const state = await primeState();
    await sourceBaseNode.execute(Batch.of(state), stubContext);
    const result = await sourceRelatedNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<SourceOutput>(state.output);
    assert.ok(Array.isArray(out.related_sources), 'related_sources is array');
    assert.ok(out.related_sources.length > 0, 'core rulebook has catalog entries');

    const dwarf = out.related_sources.find((entry) => entry.name === 'Dwarf' && entry.kind === 'Ancestries');
    assert.ok(dwarf !== undefined, 'Dwarf ancestry catalogued from Core Rulebook');
    assert.equal(dwarf?.category, 'Ancestries');
  });

  it('error path — returns error when aonprdCheerio/aonprdTarget missing', async () => {
    const state = makeState('', URL);
    const result = await sourceRelatedNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });
});

describe('finalize:source — source-core-rulebook', () => {
  it('assembles complete SourceOutput with all required fields', async () => {
    const out = await primeAndRunFull();
    assert.equal(out.name, 'Core Rulebook');
    assert.equal(out.source_id, 1);
    assert.equal(out.product_page, 'https://store.paizo.com/pathfinder-core-rulebook/');
    assert.equal(out.release_date, '8/1/2019');
    assert.equal(out.product_line, 'Rulebooks');
    assert.equal(out.latest_errata, '4.0 - 1/3/2023');
    assert.ok(Array.isArray(out.related_sources), 'related_sources present');
    assert.ok(out.related_sources.length > 0, 'related_sources non-empty');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields present');
    assert.ok('meta_description' in out, 'meta_description present');
    assert.ok('meta_keywords' in out, 'meta_keywords present');
  });

  it('strips claimed product-metadata labels from raw_fields', async () => {
    const out = await primeAndRunFull();
    assert.equal(out.raw_fields['Product Page'],  undefined, 'Product Page stripped');
    assert.equal(out.raw_fields['Release Date'],  undefined, 'Release Date stripped');
    assert.equal(out.raw_fields['Product Line'],  undefined, 'Product Line stripped');
    assert.equal(out.raw_fields['Latest Errata'], undefined, 'Latest Errata stripped');
  });

  it('error path — soft-fails to success when prerequisites missing', async () => {
    const state = makeState('', URL);
    const result = await finalizeSourceNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));
  });
});
