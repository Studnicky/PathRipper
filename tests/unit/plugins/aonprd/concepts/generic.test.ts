// Unit tests for generic concept capability nodes.
//
// The generic concept is a fallback with urlPaths: []. It has no direct URL
// route — it exists so the taxonomy can route to it once a generic-fallback
// annotation is added. Tests verify the capability node works correctly when
// invoked directly.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { loadAndCommonNode }   from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import {
  genericExtractNode,
  genericConcept,
} from '../../../../../plugins/aonprd/concepts/generic/concept.js';
import type { GenericOutput } from '../../../../../plugins/aonprd/concepts/generic/types.js';
import { loadFixture, makeState, stubContext } from '../nodes/helpers.js';

// Use an unknown-type fixture — any page works for the generic fallback.
const FIXTURE = 'generic-unknown-type.html';
// URL does not match any known AON path — typical use-case for generic.
const URL     = 'https://2e.aonprd.com/UnknownType.aspx?ID=1';

async function primeState() {
  const html  = await loadFixture(FIXTURE);
  const state = makeState(html, URL);
  await loadAndCommonNode.execute(state, stubContext);
  return state;
}

async function primeAndRunFull() {
  const state = await primeState();
  await genericExtractNode.execute(state, stubContext);
  return state.output as GenericOutput;
}

describe('extract:generic — generic-unknown-type', () => {
  it('produces _type: generic, name, and generic_id', async () => {
    const state = await primeState();
    const r = await genericExtractNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as GenericOutput;
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
    const r = await genericExtractNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
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
