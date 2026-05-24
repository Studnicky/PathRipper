// Unit tests for npc-theme-template concept capability nodes (Phase 6.4).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { loadAndCommonNode }           from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import { sectionWalkerNode }           from '../../../../../plugins/aonprd/capabilities/sectionWalker.js';
import { labelPairBlockNode }          from '../../../../../plugins/aonprd/capabilities/labelPairBlock.js';
import { sourceRefNode }               from '../../../../../plugins/aonprd/capabilities/sourceRef.js';
import {
  npcThemeTemplateBaseNode,
  npcThemeTemplateTraitsModsNode,
  finalizeNpcThemeTemplateNode,
} from '../../../../../plugins/aonprd/concepts/npc-theme-template.js';
import type { NpcThemeTemplateOutput } from '../../../../../plugins/aonprd/concepts/npc-theme-template.js';
import { loadFixture, makeState, stubContext } from '../nodes/helpers.js';

async function primeState(fixtureName: string, url: string) {
  const html  = await loadFixture(fixtureName);
  const state = makeState(html, url);
  await loadAndCommonNode.execute(state, stubContext);
  await labelPairBlockNode.execute(state, stubContext);
  await sectionWalkerNode.execute(state, stubContext);
  await sourceRefNode.execute(state, stubContext);
  return state;
}

async function primeAndRunFull(fixtureName: string, url: string) {
  const state = await primeState(fixtureName, url);
  await npcThemeTemplateBaseNode.execute(state, stubContext);
  await npcThemeTemplateTraitsModsNode.execute(state, stubContext);
  await finalizeNpcThemeTemplateNode.execute(state, stubContext);
  return state.output as NpcThemeTemplateOutput;
}

// ─── extract:npc-theme-template-base ─────────────────────────────────────────

describe('extract:npc-theme-template-base — npc-theme-template-firebrands', () => {
  it('produces _type, name, npc_theme_template_id', async () => {
    const state = await primeState('npc-theme-template-firebrands.html', 'https://2e.aonprd.com/NPCThemeTemplates.aspx?ID=1');
    const r = await npcThemeTemplateBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as NpcThemeTemplateOutput;
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name should be non-empty');
    assert.equal(out.npc_theme_template_id, 1);
  });

  it('source.book is populated', async () => {
    const state = await primeState('npc-theme-template-firebrands.html', 'https://2e.aonprd.com/NPCThemeTemplates.aspx?ID=1');
    await npcThemeTemplateBaseNode.execute(state, stubContext);
    const out = state.output as NpcThemeTemplateOutput;
    assert.ok(out.source.book !== null, 'source.book should be non-null');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/NPCThemeTemplates.aspx?ID=1');
    const r = await npcThemeTemplateBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

// ─── extract:npc-theme-template-traits-mods ──────────────────────────────────

describe('extract:npc-theme-template-traits-mods — npc-theme-template-firebrands', () => {
  it('produces tiers as an array with at least one entry', async () => {
    const state = await primeState('npc-theme-template-firebrands.html', 'https://2e.aonprd.com/NPCThemeTemplates.aspx?ID=1');
    const r = await npcThemeTemplateTraitsModsNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as Partial<NpcThemeTemplateOutput>;
    assert.ok(Array.isArray(out.tiers), 'tiers should be an array');
    assert.ok((out.tiers?.length ?? 0) > 0, 'tiers should have at least one entry');
  });

  it('tier entries have level, label, text fields', async () => {
    const state = await primeState('npc-theme-template-firebrands.html', 'https://2e.aonprd.com/NPCThemeTemplates.aspx?ID=1');
    await npcThemeTemplateTraitsModsNode.execute(state, stubContext);
    const out = state.output as Partial<NpcThemeTemplateOutput>;
    const first = out.tiers?.[0];
    assert.ok(first !== undefined, 'tiers should have at least one entry');
    assert.ok(typeof first.level === 'number', 'tier.level should be a number');
    assert.ok(typeof first.label === 'string' && first.label.length > 0, 'tier.label missing');
    assert.ok(typeof first.text === 'string', 'tier.text missing');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/NPCThemeTemplates.aspx?ID=1');
    const r = await npcThemeTemplateTraitsModsNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

// ─── Full pipeline ────────────────────────────────────────────────────────────

describe('full npc-theme-template pipeline — npc-theme-template-firebrands', () => {
  it('produces a complete NpcThemeTemplateOutput with all required fields', async () => {
    const out = await primeAndRunFull('npc-theme-template-firebrands.html', 'https://2e.aonprd.com/NPCThemeTemplates.aspx?ID=1');

    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name missing');
    assert.ok(Array.isArray(out.tiers) && out.tiers.length > 0, 'tiers missing');
    assert.ok(Array.isArray(out.sections), 'sections missing');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
    assert.ok(Array.isArray(out.links), 'links missing');
    assert.ok(typeof out.body_text === 'string', 'body_text missing');
  });
});
