// Unit tests for new and improved aonprd extractors:
//   - monster-family (MonsterFamilies.aspx)
//   - rule (Rules.aspx)
//   - NPC routing as monster (NPCs.aspx)
//   - ancestry mechanic fields from h2 sections
//   - class key_attribute / hp / initial_proficiencies
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseAonHtml }    from '../../../../plugins/aonprd/parse.task.js';
import { detectPageType }  from '../../../../plugins/aonprd/common.js';
import { loadFixture }     from './nodes/helpers.js';

// ─── detectPageType additions ─────────────────────────────────────────────────

describe('detectPageType — new URL patterns', () => {
  it('routes NPCs.aspx to monster', () => {
    assert.equal(detectPageType('https://2e.aonprd.com/NPCs.aspx?ID=42'), 'monster');
  });

  it('routes MonsterFamilies.aspx to monster-family', () => {
    assert.equal(detectPageType('https://2e.aonprd.com/MonsterFamilies.aspx?ID=10'), 'monster-family');
  });

  it('routes Rules.aspx to rule', () => {
    assert.equal(detectPageType('https://2e.aonprd.com/Rules.aspx?ID=100'), 'rule');
  });
});

// ─── MonsterFamily extractor ─────────────────────────────────────────────────

describe('extractMonsterFamily — Elemental Metal family', () => {
  it('extracts the correct name', async () => {
    const html = await loadFixture('monster-family-elemental-metal.html');
    const out  = await parseAonHtml(html, 'https://2e.aonprd.com/MonsterFamilies.aspx?ID=343');
    assert.equal((out as unknown as { name: string }).name, 'Elemental, Metal');
  });

  it('extracts monster_family_id from URL', async () => {
    const html = await loadFixture('monster-family-elemental-metal.html');
    const out  = await parseAonHtml(html, 'https://2e.aonprd.com/MonsterFamilies.aspx?ID=343');
    assert.equal((out as unknown as { monster_family_id: number }).monster_family_id, 343);
  });

  it('extracts at least one member', async () => {
    const html    = await loadFixture('monster-family-elemental-metal.html');
    const out     = await parseAonHtml(html, 'https://2e.aonprd.com/MonsterFamilies.aspx?ID=343');
    const members = (out as unknown as { members: unknown[] }).members;
    assert.ok(members.length > 0, 'should have at least one member');
  });

  it('members have name and monster_id', async () => {
    const html    = await loadFixture('monster-family-elemental-metal.html');
    const out     = await parseAonHtml(html, 'https://2e.aonprd.com/MonsterFamilies.aspx?ID=343');
    const members = (out as unknown as { members: Array<{ name: string; monster_id: number | null; kind: string }> }).members;
    const first   = members[0]!;
    assert.ok(typeof first.name === 'string' && first.name.length > 0, 'member has name');
    assert.ok(first.monster_id !== null && typeof first.monster_id === 'number', 'member has monster_id');
  });

  it('extracts source', async () => {
    const html = await loadFixture('monster-family-elemental-metal.html');
    const out  = await parseAonHtml(html, 'https://2e.aonprd.com/MonsterFamilies.aspx?ID=343');
    assert.ok((out as unknown as { source: { book: string | null } }).source.book !== null, 'source.book should be populated');
  });
});

// ─── Rule extractor ───────────────────────────────────────────────────────────

describe('extractRule — Alchemy Unleashed rule page', () => {
  it('extracts the correct rule name', async () => {
    const html = await loadFixture('rule-alchemy-unleashed.html');
    const out  = await parseAonHtml(html, 'https://2e.aonprd.com/Rules.aspx?ID=3589&NoRedirect=1');
    assert.equal((out as unknown as { name: string }).name, 'Alchemy Unleashed');
  });

  it('extracts rule_id from URL', async () => {
    const html = await loadFixture('rule-alchemy-unleashed.html');
    const out  = await parseAonHtml(html, 'https://2e.aonprd.com/Rules.aspx?ID=3589&NoRedirect=1');
    assert.equal((out as unknown as { rule_id: number }).rule_id, 3589);
  });

  it('extracts source from div.sources', async () => {
    const html = await loadFixture('rule-alchemy-unleashed.html');
    const out  = await parseAonHtml(html, 'https://2e.aonprd.com/Rules.aspx?ID=3589&NoRedirect=1');
    assert.equal((out as unknown as { source: { book: string | null; page: number | null } }).source.book, 'Treasure Vault');
    assert.equal((out as unknown as { source: { book: string | null; page: number | null } }).source.page, 41);
  });

  it('extracts child_rules', async () => {
    const html  = await loadFixture('rule-alchemy-unleashed.html');
    const out   = await parseAonHtml(html, 'https://2e.aonprd.com/Rules.aspx?ID=3589&NoRedirect=1');
    const rules = (out as unknown as { child_rules: Array<{ heading: string; rule_id: number | null }> }).child_rules;
    assert.ok(rules.length > 0, 'should have child rules');
    assert.ok(rules[0]!.heading.length > 0, 'child rule has heading');
  });

  it('has body_text with rule prose', async () => {
    const html = await loadFixture('rule-alchemy-unleashed.html');
    const out  = await parseAonHtml(html, 'https://2e.aonprd.com/Rules.aspx?ID=3589&NoRedirect=1');
    assert.ok(((out as unknown as { body_text?: string }).body_text?.length ?? 0) > 50, 'rule should have prose body_text');
  });
});

// ─── NPC routing as monster ───────────────────────────────────────────────────

describe('NPCs.aspx routed to monster extractor', () => {
  it('extracts name correctly', async () => {
    const html = await loadFixture('npc-advisor.html');
    const out  = await parseAonHtml(html, 'https://2e.aonprd.com/NPCs.aspx?ID=3420');
    assert.equal((out as unknown as { name: string }).name, 'Advisor');
  });

  it('extracts creature level', async () => {
    const html = await loadFixture('npc-advisor.html');
    const out  = await parseAonHtml(html, 'https://2e.aonprd.com/NPCs.aspx?ID=3420');
    // Level should be extracted from the statblock
    assert.ok((out as unknown as { level: number | null }).level !== null, 'NPC should have a level');
  });
});

// ─── Ancestry mechanic fields ─────────────────────────────────────────────────

describe('extractAncestry — Goblin (modern h2-section layout)', () => {
  it('extracts hit_points from h2 section', async () => {
    const html = await loadFixture('ancestry-goblin.html');
    const out  = await parseAonHtml(html, 'https://2e.aonprd.com/Ancestries.aspx?ID=4');
    assert.equal((out as unknown as { mechanics: { hit_points: number | null } }).mechanics.hit_points, 6);
  });

  it('extracts size from h2 section', async () => {
    const html = await loadFixture('ancestry-goblin.html');
    const out  = await parseAonHtml(html, 'https://2e.aonprd.com/Ancestries.aspx?ID=4');
    assert.equal((out as unknown as { mechanics: { size: string | null } }).mechanics.size, 'Small');
  });

  it('extracts speed from h2 section', async () => {
    const html = await loadFixture('ancestry-goblin.html');
    const out  = await parseAonHtml(html, 'https://2e.aonprd.com/Ancestries.aspx?ID=4');
    assert.equal((out as unknown as { mechanics: { speed: number | null } }).mechanics.speed, 25);
  });

  it('extracts attribute_boosts as individual items', async () => {
    const html   = await loadFixture('ancestry-goblin.html');
    const out    = await parseAonHtml(html, 'https://2e.aonprd.com/Ancestries.aspx?ID=4');
    const boosts = (out as unknown as { mechanics: { attribute_boosts: string[] } }).mechanics.attribute_boosts;
    assert.ok(boosts.length > 1, 'should have multiple attribute boosts');
    assert.ok(boosts.includes('Dexterity'), 'should include Dexterity');
    assert.ok(boosts.includes('Free'), 'should include Free');
  });

  it('extracts attribute_flaws', async () => {
    const html  = await loadFixture('ancestry-goblin.html');
    const out   = await parseAonHtml(html, 'https://2e.aonprd.com/Ancestries.aspx?ID=4');
    const flaws = (out as unknown as { mechanics: { attribute_flaws: string[] } }).mechanics.attribute_flaws;
    assert.ok(flaws.length > 0, 'should have at least one flaw');
  });
});

// ─── Class mechanic fields ────────────────────────────────────────────────────

describe('extractClass — Sorcerer (modern inline bold layout)', () => {
  it('extracts key_attribute from inline bold', async () => {
    const html = await loadFixture('class-sorcerer.html');
    const out  = await parseAonHtml(html, 'https://2e.aonprd.com/Classes.aspx?ID=11');
    const keyAttr = (out as unknown as { key_attribute: string | null }).key_attribute;
    assert.ok(keyAttr !== null && keyAttr.length > 0, 'key_attribute should be populated');
  });

  it('extracts hp_per_level from inline bold', async () => {
    const html       = await loadFixture('class-sorcerer.html');
    const out        = await parseAonHtml(html, 'https://2e.aonprd.com/Classes.aspx?ID=11');
    const hpPerLevel = (out as unknown as { hp_per_level: number | null }).hp_per_level;
    assert.ok(hpPerLevel !== null && hpPerLevel > 0, 'hp_per_level should be a positive number');
  });

  it('extracts initial_proficiencies from h1>h2 sections', async () => {
    const html  = await loadFixture('class-sorcerer.html');
    const out   = await parseAonHtml(html, 'https://2e.aonprd.com/Classes.aspx?ID=11');
    const profs = (out as unknown as { initial_proficiencies: Record<string, string> }).initial_proficiencies;
    assert.ok(Object.keys(profs).length > 2, 'should have multiple proficiency categories');
    assert.ok('Perception' in profs, 'should have Perception proficiency');
  });
});
