// Unit tests for trait concept capability nodes.
import { describe, it } from 'node:test';
import { Batch } from '@studnicky/dagonizer';
import assert from 'node:assert/strict';

import { loadAndCommonNode }           from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import { sectionWalkerNode }           from '../../../../../plugins/aonprd/capabilities/sectionWalker.js';
import { labelPairBlockNode }          from '../../../../../plugins/aonprd/capabilities/labelPairBlock.js';
import { sourceRefNode }               from '../../../../../plugins/aonprd/capabilities/sourceRef.js';
import {
  traitBaseNode,
  finalizeTraitNode,
} from '../../../../../plugins/aonprd/concepts/trait/index.js';
import type { TraitOutput } from '../../../../../plugins/aonprd/concepts/trait/index.js';
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
  await traitBaseNode.execute(Batch.of(state), stubContext);
  await finalizeTraitNode.execute(Batch.of(state), stubContext);
  return ParsedOutput.as<TraitOutput>(state.output);
}

describe('extract:trait-base — trait-magical', () => {
  it('produces _type, name, trait_id', async () => {
    const state = await primeState('trait-magical.html', 'https://2e.aonprd.com/Traits.aspx?ID=103');
    const result = await traitBaseNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<TraitOutput>(state.output);
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name should be non-empty');
    assert.equal(out.trait_id, 103);
  });

  it('error path — returns error when prerequisites missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Traits.aspx?ID=103');
    const result = await traitBaseNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });
});

describe('finalize:trait — trait-magical', () => {
  it('produces sections, raw_fields, body_text, category', async () => {
    const state = await primeState('trait-magical.html', 'https://2e.aonprd.com/Traits.aspx?ID=103');
    await traitBaseNode.execute(Batch.of(state), stubContext);
    const result = await finalizeTraitNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<TraitOutput>(state.output);
    assert.ok(Array.isArray(out.sections), 'sections missing');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
    assert.ok(typeof out.body_text === 'string', 'body_text missing');
    // category is inferred from body links; may be null for generic traits
    assert.ok('category' in out, 'category field missing');
  });

  it('sections[] does not contain legacy-content-warning', async () => {
    const out = await primeAndRunFull('trait-magical.html', 'https://2e.aonprd.com/Traits.aspx?ID=103');
    const legacySection = out.sections.find((sec) =>
      /legacy[\s-]content[\s-]warning/i.test(sec.heading),
    );
    assert.equal(legacySection, undefined, 'legacy-content-warning section should be filtered');
  });

  it('error path — soft-fails to success when prerequisites missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Traits.aspx?ID=103');
    const result = await finalizeTraitNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));
  });
});

describe('full trait pipeline — trait-magical', () => {
  it('produces complete TraitOutput', async () => {
    const out = await primeAndRunFull('trait-magical.html', 'https://2e.aonprd.com/Traits.aspx?ID=103');
    assert.equal(out.trait_id, 103);
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name missing');
    assert.ok(typeof out.body_text === 'string', 'body_text missing');
    assert.ok(Array.isArray(out.sections), 'sections missing');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
  });

  it('source is populated from Source field', async () => {
    const out = await primeAndRunFull('trait-magical.html', 'https://2e.aonprd.com/Traits.aspx?ID=103');
    assert.ok(out.sources.length > 0 || out.source.book !== null, 'source data should be present');
  });
});
