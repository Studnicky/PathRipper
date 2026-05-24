// Unit tests for rule concept capability nodes (Phase 6.4).
//
// Rule pages bypass extractCommon entirely — `loadAndCommonNode` only stashes
// `aonprdCheerio`. All capability nodes read from `aonprdCheerio` directly and
// build a `RuleContext` via `buildRuleContext($)`.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { loadAndCommonNode }   from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import {
  ruleBaseNode,
  ruleSubsectionsNode,
  finalizeRuleConceptNode,
} from '../../../../../plugins/aonprd/concepts/rule.js';
import type { RuleOutput } from '../../../../../plugins/aonprd/concepts/rule.js';
import { loadFixture, makeState, stubContext } from '../nodes/helpers.js';

const FIXTURE_RULE = 'rule-alchemy-unleashed.html';
const URL_RULE     = 'https://2e.aonprd.com/Rules.aspx?ID=1';

async function primeState(fixtureName: string, url: string) {
  const html  = await loadFixture(fixtureName);
  const state = makeState(html, url);
  // loadAndCommonNode detects 'rule' page type and only stashes aonprdCheerio.
  const r = await loadAndCommonNode.execute(state, stubContext);
  assert.equal(r.output, 'success', `loadAndCommon failed for ${fixtureName}`);
  return state;
}

async function primeAndRunFull(fixtureName: string, url: string) {
  const state = await primeState(fixtureName, url);
  await ruleBaseNode.execute(state, stubContext);
  await ruleSubsectionsNode.execute(state, stubContext);
  await finalizeRuleConceptNode.execute(state, stubContext);
  return state.output as RuleOutput;
}

// ─── extract:rule-base ────────────────────────────────────────────────────────

describe('extract:rule-base — alchemy-unleashed', () => {
  it('produces _type, name, url, rule_id, body_text', async () => {
    const state = await primeState(FIXTURE_RULE, URL_RULE);
    const r = await ruleBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as RuleOutput;
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name missing');
    assert.ok('rule_id' in out, 'rule_id missing');
    assert.ok(typeof out.body_text === 'string', 'body_text missing');
    assert.ok(typeof out.body_html === 'string', 'body_html missing');
  });

  it('sources array is populated from div.sources format', async () => {
    const state = await primeState(FIXTURE_RULE, URL_RULE);
    await ruleBaseNode.execute(state, stubContext);

    const out = state.output as RuleOutput;
    assert.ok(Array.isArray(out.sources), 'sources missing');
    // source.book may be null but the object must exist
    assert.ok('source' in out, 'source key missing');
    assert.ok('book' in out.source, 'source.book missing');
  });

  it('error path — returns error when aonprdCheerio missing', async () => {
    const state = makeState('', URL_RULE);
    // Don't prime with loadAndCommon — no metadata stashed
    const r = await ruleBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

// ─── extract:rule-subsections ────────────────────────────────────────────────

describe('extract:rule-subsections — alchemy-unleashed', () => {
  it('produces child_rules and sections arrays', async () => {
    const state = await primeState(FIXTURE_RULE, URL_RULE);
    await ruleBaseNode.execute(state, stubContext);
    const r = await ruleSubsectionsNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as RuleOutput;
    assert.ok(Array.isArray(out.child_rules), 'child_rules missing');
    assert.ok(Array.isArray(out.sections), 'sections missing');
  });

  it('error path — returns error when aonprdCheerio missing', async () => {
    const state = makeState('', URL_RULE);
    const r = await ruleSubsectionsNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

// ─── finalize:rule ────────────────────────────────────────────────────────────

describe('finalize:rule — alchemy-unleashed', () => {
  it('produces complete RuleOutput with all required fields', async () => {
    const out = await primeAndRunFull(FIXTURE_RULE, URL_RULE);
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name missing');
    assert.ok(Array.isArray(out.child_rules), 'child_rules missing');
    assert.ok(Array.isArray(out.sections), 'sections missing');
    assert.ok(Array.isArray(out.links), 'links missing');
    assert.ok(typeof out.body_text === 'string', 'body_text missing');
    assert.ok(typeof out.body_html === 'string', 'body_html missing');
  });

  it('no raw_fields on rule pages (no field map)', async () => {
    const out = await primeAndRunFull(FIXTURE_RULE, URL_RULE);
    // Rule pages don't have raw_fields — they have no <b>Label</b> field map.
    // Verify the output shape matches RuleOutput (no raw_fields key expected).
    assert.ok(!('raw_fields' in out), 'rule pages should not have raw_fields');
  });

  it('error path — soft-fails to success when prerequisites missing', async () => {
    const state = makeState('', URL_RULE);
    const r = await finalizeRuleConceptNode.execute(state, stubContext);
    assert.equal(r.output, 'success');
  });
});

// ─── Full pipeline ────────────────────────────────────────────────────────────

describe('full rule pipeline — alchemy-unleashed', () => {
  it('produces a complete RuleOutput with meta tags', async () => {
    const out = await primeAndRunFull(FIXTURE_RULE, URL_RULE);
    assert.ok(typeof out.name === 'string' && out.name.length > 0);
    assert.ok(typeof out.meta_description === 'string' || out.meta_description === null);
    assert.ok(typeof out.meta_keywords === 'string' || out.meta_keywords === null);
  });

  it('loadAndCommon leaves aonprdCommon absent for rule pages', async () => {
    const html  = await loadFixture(FIXTURE_RULE);
    const state = makeState(html, URL_RULE);
    await loadAndCommonNode.execute(state, stubContext);
    // Rule pages should have aonprdCheerio but NOT aonprdCommon
    assert.ok(state.getMetadata('aonprdCheerio') !== undefined, 'aonprdCheerio should be stashed');
    assert.equal(state.getMetadata('aonprdCommon'), undefined, 'aonprdCommon should NOT be stashed for rule pages');
  });
});
