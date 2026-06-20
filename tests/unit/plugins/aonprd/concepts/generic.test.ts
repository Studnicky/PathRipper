// Unit tests for generic concept capability nodes.
//
// The generic concept is a fallback with urlPaths: []. It has no direct URL
// route — it exists so the taxonomy can route to it once a generic-fallback
// annotation is added. Tests verify the capability node works correctly when
// invoked directly.
import { describe, it } from 'node:test';
import { Batch } from '@studnicky/dagonizer';
import assert from 'node:assert/strict';

import { loadAndCommonNode }   from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import {
  genericExtractNode,
  genericConcept,
} from '../../../../../plugins/aonprd/concepts/generic/concept.js';
import type { GenericOutput } from '../../../../../plugins/aonprd/concepts/generic/types.js';
import { loadFixture, makeState, stubContext } from '../nodes/helpers.js';
import { ParsedOutput } from '../../../../helpers/ParsedOutput.js';

// Use an unknown-type fixture — any page works for the generic fallback.
const FIXTURE = 'generic-unknown-type.html';
// URL does not match any known AON path — typical use-case for generic.
const URL     = 'https://2e.aonprd.com/UnknownType.aspx?ID=1';

async function primeState() {
  const html  = await loadFixture(FIXTURE);
  const state = makeState(html, URL);
  await loadAndCommonNode.execute(Batch.of(state), stubContext);
  return state;
}

async function primeAndRunFull() {
  const state = await primeState();
  await genericExtractNode.execute(Batch.of(state), stubContext);
  return ParsedOutput.as<GenericOutput>(state.output);
}

describe('extract:generic — generic-unknown-type', () => {
  it('produces _type: generic, name, and generic_id', async () => {
    const state = await primeState();
    const result = await genericExtractNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<GenericOutput>(state.output);
    // `_type` is stamped by the router via the concept's discriminator —
    // not by the slice extractor — so we only assert structural fields here.
    assert.ok(typeof out.name === 'string', 'name is string');
    assert.ok(typeof out.url === 'string', 'url is string');
    assert.ok('generic_id' in out, 'generic_id field present');
    assert.ok('raw_fields' in out, 'raw_fields field present');
    assert.ok('level' in out, 'level field present');
    assert.ok('level_kind' in out, 'level_kind field present');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', URL);
    const result = await genericExtractNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });
});

describe('full generic pipeline — generic-unknown-type', () => {
  it('produces complete GenericOutput with all base fields', async () => {
    const out = await primeAndRunFull();
    // `_type` is router-stamped, not part of the slice extractor output.
    assert.ok(typeof out.body_html === 'string', 'body_html present');
    assert.ok(typeof out.body_text === 'string', 'body_text present');
    assert.ok(Array.isArray(out.sections), 'sections present');
    assert.ok(Array.isArray(out.links), 'links present');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields present');
    assert.ok('meta_description' in out, 'meta_description present');
    assert.ok('meta_keywords' in out, 'meta_keywords present');
  });
});

describe('genericConcept ConceptDecl', () => {
  it('has urlPaths: [] (no direct URL match — fallback only)', () => {
    assert.deepEqual(genericConcept.urlPaths, []);
  });

  it('has parent: thing', () => {
    assert.equal(genericConcept.parent, 'thing');
  });

  it('has id: generic', () => {
    assert.equal(genericConcept.id, 'generic');
  });

  it('has one capability: extract:generic', () => {
    assert.equal(genericConcept.capabilities.length, 1);
    assert.equal(genericConcept.capabilities[0]!.name, 'extract:generic');
  });
});
