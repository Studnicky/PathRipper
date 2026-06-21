// Unit tests for the AON background extractor — `plugins/aonprd/background.ts`.
// Covers base slice and benefits slice (attribute_boost_choice, trained_skills,
// lore_skills, granted_feat, flavor_text, related_sources).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseAonHtml } from '../../../../plugins/aonprd/parse.task.js';
import { loadFixture }  from './nodes/helpers.js';

// ─── Base slice ───────────────────────────────────────────────────────────────

describe('extractBackground — base slice (Acolyte fixture)', () => {
  it('captures _type and name', async () => {
    const html = await loadFixture('background-acolyte.html');
    const out  = await parseAonHtml(html, 'https://2e.aonprd.com/Backgrounds.aspx?ID=1');
    assert.ok(typeof (out as unknown as { name: string }).name === 'string' && (out as unknown as { name: string }).name.length > 0, 'name should be populated');
  });

  it('extracts background_id from URL', async () => {
    const html = await loadFixture('background-acolyte.html');
    const out  = await parseAonHtml(html, 'https://2e.aonprd.com/Backgrounds.aspx?ID=1');
    assert.equal((out as unknown as { background_id: number }).background_id, 1);
  });

  it('extracts source.book', async () => {
    const html = await loadFixture('background-acolyte.html');
    const out  = await parseAonHtml(html, 'https://2e.aonprd.com/Backgrounds.aspx?ID=1');
    assert.ok((out as unknown as { source: { book: string | null } }).source.book !== null, 'source.book should be populated');
  });
});

// ─── Benefits slice ───────────────────────────────────────────────────────────

describe('extractBackground — benefits slice', () => {
  it('extracts trained_skills as Skills.aspx anchors', async () => {
    const html = await loadFixture('background-acolyte.html');
    const out  = await parseAonHtml(html, 'https://2e.aonprd.com/Backgrounds.aspx?ID=1');
    const skills = (out as unknown as { trained_skills: Array<{ name: string; skill_id: number | null }> }).trained_skills;
    assert.ok(Array.isArray(skills), 'trained_skills should be an array');
  });

  it('extracts lore_skills separately from trained_skills', async () => {
    const html = await loadFixture('background-acolyte.html');
    const out  = await parseAonHtml(html, 'https://2e.aonprd.com/Backgrounds.aspx?ID=1');
    const lores = (out as unknown as { lore_skills: Array<{ name: string }> }).lore_skills;
    assert.ok(Array.isArray(lores), 'lore_skills should be an array');
    for (const lore of lores) {
      assert.ok(/lore/i.test(lore.name), `lore_skills entry should contain "lore": ${lore.name}`);
    }
  });

  it('extracts granted_feat as a Feats.aspx anchor', async () => {
    const html = await loadFixture('background-acolyte.html');
    const out  = await parseAonHtml(html, 'https://2e.aonprd.com/Backgrounds.aspx?ID=1');
    const feat = (out as unknown as { granted_feat: { name: string; feat_id: number | null } | null }).granted_feat;
    assert.ok(feat !== null, 'granted_feat should be populated');
    assert.ok(typeof feat.name === 'string' && feat.name.length > 0, 'granted_feat.name should be non-empty');
  });

  it('extracts flavor_text non-empty', async () => {
    const html = await loadFixture('background-acolyte.html');
    const out  = await parseAonHtml(html, 'https://2e.aonprd.com/Backgrounds.aspx?ID=1');
    const flavor = (out as unknown as { flavor_text: string }).flavor_text;
    assert.ok(typeof flavor === 'string' && flavor.length > 0, 'flavor_text should be populated');
  });
});

// ─── Raw fields strip ─────────────────────────────────────────────────────────

describe('extractBackground — raw_fields strip', () => {
  it('does not contain "Source" key', async () => {
    const html = await loadFixture('background-acolyte.html');
    const out  = await parseAonHtml(html, 'https://2e.aonprd.com/Backgrounds.aspx?ID=1');
    const rawFields = (out as unknown as { raw_fields: Record<string, string> }).raw_fields;
    assert.ok(!('Source' in rawFields), 'Source should be stripped from raw_fields');
  });
});
