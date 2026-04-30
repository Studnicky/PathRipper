// Unit tests for the AON parse plugin.
// Operates against committed HTML fixtures (no network) to verify per-type
// extractors against real-world AON page shapes. End-to-end tests against the
// live site live in tests/e2e/aonprd-plugin.test.ts.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseAonHtml } from '../../../plugins/aonprd/parse.task.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function load(name: string): Promise<string> {
  return readFile(resolve(__dirname, 'fixtures/aonprd', name), 'utf-8');
}

// ─── Spell ───────────────────────────────────────────────────────────────────

describe('aonprd plugin — spell extractor', () => {
  it('parses Abyssal Plague title, rank, and traditions', async () => {
    const html = await load('spell-abyssal-plague.html');
    const r = parseAonHtml(html, 'https://2e.aonprd.com/Spells.aspx?ID=1');
    if (r._type !== 'spell') throw new Error(`expected spell, got ${r._type}`);
    assert.equal(r.name, 'Abyssal Plague');
    assert.equal(r.rank, 5);
    assert.deepEqual([...r.traditions].sort(), ['divine', 'occult']);
    assert.ok(r.traits.includes('Necromancy'), `traits: ${r.traits.join(',')}`);
  });

  it('captures spell source, save, range, targets', async () => {
    const html = await load('spell-abyssal-plague.html');
    const r = parseAonHtml(html, 'https://2e.aonprd.com/Spells.aspx?ID=1');
    if (r._type !== 'spell') throw new Error(`expected spell, got ${r._type}`);
    assert.equal(r.source.book, 'Core Rulebook');
    assert.equal(r.source.page, 316);
    assert.ok(r.range !== null && /touch/i.test(r.range), `range: ${r.range ?? '?'}`);
    assert.ok(r.targets !== null && /1 creature/i.test(r.targets), `targets: ${r.targets ?? '?'}`);
    assert.ok(r.saving_throw !== null && /Fortitude/i.test(r.saving_throw.raw ?? ''),
      `save: ${JSON.stringify(r.saving_throw)}`);
  });

  it('extracts the affliction subentry and stages', async () => {
    const html = await load('spell-abyssal-plague.html');
    const r = parseAonHtml(html, 'https://2e.aonprd.com/Spells.aspx?ID=1');
    if (r._type !== 'spell') throw new Error('not spell');
    assert.ok(r.affliction !== null, 'affliction must be detected');
    assert.equal(r.affliction.type, 'disease');
    assert.equal(r.affliction.level, 9);
    assert.ok(r.affliction.stages.length >= 2,
      `expected ≥2 stages, got ${r.affliction.stages.length.toString()}`);
  });

  it('captures save outcome tiers (Critical Success/Success/Failure)', async () => {
    const html = await load('spell-abyssal-plague.html');
    const r = parseAonHtml(html, 'https://2e.aonprd.com/Spells.aspx?ID=1');
    if (r._type !== 'spell') throw new Error('not spell');
    assert.ok(r.outcomes.critical_success !== null, 'critical_success missing');
    assert.ok(r.outcomes.success !== null,          'success missing');
    assert.ok(r.outcomes.failure !== null,          'failure missing');
    assert.ok(r.outcomes.critical_failure !== null, 'critical_failure missing');
  });

  it('preserves cross-reference links from the body', async () => {
    const html = await load('spell-abyssal-plague.html');
    const r = parseAonHtml(html, 'https://2e.aonprd.com/Spells.aspx?ID=1');
    if (r._type !== 'spell') throw new Error('not spell');
    const traitLinks = r.links.filter((l) => l.kind === 'Traits');
    assert.ok(traitLinks.length >= 4,
      `expected ≥4 trait cross-refs, got ${traitLinks.length.toString()}`);
  });
});

// ─── Monster ─────────────────────────────────────────────────────────────────

describe('aonprd plugin — monster extractor', () => {
  it('parses Phantasmal Minion stat block top section', async () => {
    const html = await load('monster-phantasmal-minion.html');
    const r = parseAonHtml(html, 'https://2e.aonprd.com/Monsters.aspx?ID=1');
    if (r._type !== 'monster') throw new Error(`expected monster, got ${r._type}`);
    assert.equal(r.name, 'Phantasmal Minion');
    assert.equal(r.level, -1);
    assert.equal(r.size, 'Medium');
    assert.ok(r.traits.includes('Force'),    `traits: ${r.traits.join(',')}`);
    assert.ok(r.traits.includes('Mindless'), `traits: ${r.traits.join(',')}`);
  });

  it('captures defenses (AC, saves, HP, immunities)', async () => {
    const html = await load('monster-phantasmal-minion.html');
    const r = parseAonHtml(html, 'https://2e.aonprd.com/Monsters.aspx?ID=1');
    if (r._type !== 'monster') throw new Error('not monster');
    assert.equal(r.ac.value, 13);
    assert.equal(r.saves.fort, 0);
    assert.equal(r.saves.ref,  4);
    assert.equal(r.saves.will, 0);
    assert.equal(r.hp.value, 4);
    assert.ok(r.immunities.length >= 3,
      `expected ≥3 immunities, got ${r.immunities.length.toString()}`);
  });

  it('captures all six ability scores', async () => {
    const html = await load('monster-phantasmal-minion.html');
    const r = parseAonHtml(html, 'https://2e.aonprd.com/Monsters.aspx?ID=1');
    if (r._type !== 'monster') throw new Error('not monster');
    assert.equal(r.abilities.str, -4);
    assert.equal(r.abilities.dex,  2);
    assert.equal(r.abilities.con,  0);
    assert.equal(r.abilities.int, -5);
    assert.equal(r.abilities.wis,  0);
    assert.equal(r.abilities.cha,  0);
  });
});

// ─── Feat ────────────────────────────────────────────────────────────────────

describe('aonprd plugin — feat extractor', () => {
  it('parses Dwarven Lore feat title, level, traits, source', async () => {
    const html = await load('feat-dwarven-lore.html');
    const r = parseAonHtml(html, 'https://2e.aonprd.com/Feats.aspx?ID=1');
    if (r._type !== 'feat') throw new Error(`expected feat, got ${r._type}`);
    assert.equal(r.name, 'Dwarven Lore');
    assert.equal(r.level, 1);
    assert.ok(r.traits.includes('Dwarf'));
    assert.equal(r.source.book, 'Player Core');
  });

  it('captures the body text and trait glossary', async () => {
    const html = await load('feat-dwarven-lore.html');
    const r = parseAonHtml(html, 'https://2e.aonprd.com/Feats.aspx?ID=1');
    if (r._type !== 'feat') throw new Error('not feat');
    assert.ok(/Crafting/i.test(r.description_text), 'expected Crafting reference in body');
    assert.ok(r.trait_glossary.length >= 1,
      `expected trait glossary entries, got ${r.trait_glossary.length.toString()}`);
    assert.equal(r.trait_glossary[0]?.trait, 'Dwarf');
  });
});

// ─── Equipment ───────────────────────────────────────────────────────────────

describe('aonprd plugin — equipment extractor', () => {
  it('parses Adventurer\'s Pack price + bulk', async () => {
    const html = await load('equipment-adventurers-pack.html');
    const r = parseAonHtml(html, 'https://2e.aonprd.com/Equipment.aspx?ID=1');
    if (r._type !== 'equipment') throw new Error(`expected equipment, got ${r._type}`);
    assert.equal(r.name, "Adventurer's Pack");
    assert.equal(r.item_level, 0);
    assert.ok(r.price.gp === 1 || r.price.raw !== null,
      `price: ${JSON.stringify(r.price)}`);
    assert.equal(r.price.sp, 5);
    assert.equal(r.bulk, 1);
  });
});

// ─── Condition ───────────────────────────────────────────────────────────────

describe('aonprd plugin — condition extractor', () => {
  it('parses Blinded body and links', async () => {
    const html = await load('condition-blinded.html');
    const r = parseAonHtml(html, 'https://2e.aonprd.com/Conditions.aspx?ID=1');
    if (r._type !== 'condition') throw new Error(`expected condition, got ${r._type}`);
    assert.equal(r.name, 'Blinded');
    assert.ok(/can't see/i.test(r.body_text));
    // Cross-references to other conditions ("dazzled") and rules ("difficult terrain", "precise sense").
    assert.ok(r.related_conditions.length >= 1,
      `expected condition cross-refs, got ${r.related_conditions.length.toString()}`);
  });
});

// ─── Background ──────────────────────────────────────────────────────────────

describe('aonprd plugin — background extractor', () => {
  it('parses Acolyte attribute boost choice and trained skills', async () => {
    const html = await load('background-acolyte.html');
    const r = parseAonHtml(html, 'https://2e.aonprd.com/Backgrounds.aspx?ID=1');
    if (r._type !== 'background') throw new Error(`expected background, got ${r._type}`);
    assert.equal(r.name, 'Acolyte');
    assert.ok(r.attribute_boost_choice !== null, 'expected attribute boost choice');
    assert.deepEqual(
      [...r.attribute_boost_choice.fixed_options].sort(),
      ['Intelligence', 'Wisdom'],
    );
    assert.equal(r.attribute_boost_choice.free, true);
    assert.ok(r.trained_skills.length >= 1, 'expected ≥1 trained skill');
    assert.ok(r.granted_feat !== null, 'expected granted feat');
  });
});

// ─── Page-type discrimination ────────────────────────────────────────────────

describe('aonprd plugin — page-type detection', () => {
  it('falls back to generic for unmapped paths but still extracts shared fields', async () => {
    // Re-use the spell HTML against an unknown URL path; the plugin's URL→type
    // map will return 'generic', and the foundation should still capture the
    // title, traits, source, and body.
    const html = await load('spell-abyssal-plague.html');
    const r = parseAonHtml(html, 'https://2e.aonprd.com/Languages.aspx?ID=999');
    assert.equal(r._type, 'generic', `_type: ${r._type}`);
    if (r._type !== 'generic') throw new Error('not generic');
    assert.equal(r.name, 'Abyssal Plague');
    assert.equal(r.source.book, 'Core Rulebook');
    assert.ok(r.traits.length >= 1);
  });

  it('returns unknown when no content span is present', () => {
    const r = parseAonHtml('<html><body>nothing</body></html>', 'https://2e.aonprd.com/X.aspx?ID=1');
    assert.equal(r._type, 'unknown');
  });
});
