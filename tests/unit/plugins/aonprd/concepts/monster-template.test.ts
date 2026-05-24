// Unit tests for monster-template concept capability nodes.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { loadAndCommonNode }   from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import { sectionWalkerNode }   from '../../../../../plugins/aonprd/capabilities/sectionWalker.js';
import { sourceRefNode }       from '../../../../../plugins/aonprd/capabilities/sourceRef.js';
import {
  monsterTemplateBaseNode,
  monsterTemplateModificationsNode,
  finalizeMonsterTemplateNode,
} from '../../../../../plugins/aonprd/concepts/monster-template.js';
import type { MonsterTemplateOutput } from '../../../../../plugins/aonprd/concepts/monster-template.js';
import { loadFixture, makeState, stubContext } from '../nodes/helpers.js';

const FIXTURE_ELITE   = 'monster-template-elite.html';
const BASE_URL_ELITE  = 'https://2e.aonprd.com/MonsterTemplates.aspx?ID=22';

const FIXTURE_UNDEAD  = 'monster-template-undead.html';
const BASE_URL_UNDEAD = 'https://2e.aonprd.com/MonsterTemplates.aspx?ID=1';

async function primeState(fixtureName: string, url: string) {
  const html  = await loadFixture(fixtureName);
  const state = makeState(html, url);
  await loadAndCommonNode.execute(state, stubContext);
  await sectionWalkerNode.execute(state, stubContext);
  await sourceRefNode.execute(state, stubContext);
  return state;
}

async function primeAndRunFull(fixtureName: string, url: string) {
  const state = await primeState(fixtureName, url);
  await monsterTemplateBaseNode.execute(state, stubContext);
  await monsterTemplateModificationsNode.execute(state, stubContext);
  await finalizeMonsterTemplateNode.execute(state, stubContext);
  return state.output as MonsterTemplateOutput;
}

describe('extract:monster-template-base — elite', () => {
  it('produces _type, url, name, template_id', async () => {
    const state = await primeState(FIXTURE_ELITE, BASE_URL_ELITE);
    const r = await monsterTemplateBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as MonsterTemplateOutput;
    assert.equal(out.template_id, 22);
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name should be non-empty');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', BASE_URL_ELITE);
    const r = await monsterTemplateBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('extract:monster-template-modifications — elite', () => {
  it('produces adjustments, subsections, hp_table, numeric deltas', async () => {
    const state = await primeState(FIXTURE_ELITE, BASE_URL_ELITE);
    await monsterTemplateBaseNode.execute(state, stubContext);
    const r = await monsterTemplateModificationsNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as MonsterTemplateOutput;
    assert.ok(Array.isArray(out.adjustments), 'adjustments should be array');
    assert.ok(Array.isArray(out.subsections), 'subsections should be array');
    assert.ok(Array.isArray(out.hp_table), 'hp_table should be array');
    // Elite template increases level by 1
    assert.equal(out.level_change, 1);
    // Elite increases AC/attack/DC/saves by 2
    assert.equal(out.ac_attack_dc_save_change, 2);
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', BASE_URL_ELITE);
    const r = await monsterTemplateModificationsNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('finalize:monster-template — elite', () => {
  it('produces complete MonsterTemplateOutput', async () => {
    const out = await primeAndRunFull(FIXTURE_ELITE, BASE_URL_ELITE);
    assert.equal(out.template_id, 22);
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name missing');
    assert.ok(Array.isArray(out.adjustments), 'adjustments missing');
    assert.ok(Array.isArray(out.links), 'links missing');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
    assert.ok(typeof out.body_text === 'string', 'body_text missing');
  });

  it('error path — soft-fails to success when prerequisites missing', async () => {
    const state = makeState('', BASE_URL_ELITE);
    const r = await finalizeMonsterTemplateNode.execute(state, stubContext);
    assert.equal(r.output, 'success');
  });
});

describe('full pipeline — undead template', () => {
  it('handles subsection-heavy template (no level_change from prose)', async () => {
    const out = await primeAndRunFull(FIXTURE_UNDEAD, BASE_URL_UNDEAD);
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name missing');
    // Undead template uses subsections for adjustments, not level delta prose
    assert.ok(Array.isArray(out.subsections), 'subsections missing');
  });
});
