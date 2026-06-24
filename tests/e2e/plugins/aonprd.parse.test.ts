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
import { ParsedOutput } from '../../helpers/ParsedOutput.js';
import type { SpellOutput } from '../../../plugins/aonprd/concepts/spell/index.js';
import type { MonsterOutput } from '../../../plugins/aonprd/concepts/monster/types.js';
import type { FeatOutput } from '../../../plugins/aonprd/concepts/feat.js';
import type { EquipmentOutput } from '../../../plugins/aonprd/concepts/equipment/index.js';
import type { ConditionOutput } from '../../../plugins/aonprd/concepts/condition/index.js';
import type { BackgroundOutput } from '../../../plugins/aonprd/concepts/background.js';
import type { WeaponOutput } from '../../../plugins/aonprd/concepts/weapon.js';
import type { ActionOutput } from '../../../plugins/aonprd/concepts/action.js';
import type { LinkRef } from '../../../src/types/ExtractionStrategy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function load(name: string): Promise<string> {
  return readFile(resolve(__dirname, 'fixtures/aonprd', name), 'utf-8');
}

// ─── Spell ───────────────────────────────────────────────────────────────────

describe('aonprd plugin — spell extractor', () => {
  it('parses Abyssal Plague title, rank, and traditions', async () => {
    const html = await load('spell-abyssal-plague.html');
    const raw: unknown = await parseAonHtml(html, 'https://2e.aonprd.com/Spells.aspx?ID=1');
    const result = ParsedOutput.as<SpellOutput>(raw as Record<string, unknown>);
    assert.equal(result.name, 'Abyssal Plague');
    assert.equal(result.rank, 5);
    assert.deepEqual([...result.traditions].sort(), ['divine', 'occult']);
    assert.ok(result.traits.includes('Necromancy'), `traits: ${result.traits.join(',')}`);
  });

  it('captures spell source, save, range, targets', async () => {
    const html = await load('spell-abyssal-plague.html');
    const raw: unknown = await parseAonHtml(html, 'https://2e.aonprd.com/Spells.aspx?ID=1');
    const result = ParsedOutput.as<SpellOutput>(raw as Record<string, unknown>);
    assert.equal(result.source.book, 'Core Rulebook');
    assert.equal(result.source.page, 316);
    assert.ok(result.range !== null && /touch/i.test(result.range), `range: ${result.range ?? '?'}`);
    assert.ok(result.targets !== null && /1 creature/i.test(result.targets), `targets: ${result.targets ?? '?'}`);
    assert.ok(result.saving_throw !== null && /Fortitude/i.test(result.saving_throw.raw ?? ''),
      `save: ${JSON.stringify(result.saving_throw)}`);
  });

  it('extracts the affliction subentry and stages', async () => {
    const html = await load('spell-abyssal-plague.html');
    const raw: unknown = await parseAonHtml(html, 'https://2e.aonprd.com/Spells.aspx?ID=1');
    const result = ParsedOutput.as<SpellOutput>(raw as Record<string, unknown>);
    assert.ok(result.affliction !== null, 'affliction must be detected');
    assert.equal(result.affliction.type, 'disease');
    assert.equal(result.affliction.level, 9);
    assert.ok(result.affliction.stages.length >= 2,
      `expected ≥2 stages, got ${result.affliction.stages.length.toString()}`);
  });

  it('captures save outcome tiers (Critical Success/Success/Failure)', async () => {
    const html = await load('spell-abyssal-plague.html');
    const raw: unknown = await parseAonHtml(html, 'https://2e.aonprd.com/Spells.aspx?ID=1');
    const result = ParsedOutput.as<SpellOutput>(raw as Record<string, unknown>);
    assert.ok(result.outcomes.critical_success !== null, 'critical_success missing');
    assert.ok(result.outcomes.success !== null,          'success missing');
    assert.ok(result.outcomes.failure !== null,          'failure missing');
    assert.ok(result.outcomes.critical_failure !== null, 'critical_failure missing');
  });

  it('preserves cross-reference links from the body', async () => {
    const html = await load('spell-abyssal-plague.html');
    const raw: unknown = await parseAonHtml(html, 'https://2e.aonprd.com/Spells.aspx?ID=1');
    const result = ParsedOutput.as<SpellOutput>(raw as Record<string, unknown>);
    const traitLinks = result.links.filter((link: LinkRef) => link.kind === 'Traits');
    assert.ok(traitLinks.length >= 4,
      `expected ≥4 trait cross-refs, got ${traitLinks.length.toString()}`);
  });
});

// ─── Monster ─────────────────────────────────────────────────────────────────

describe('aonprd plugin — monster extractor', () => {
  it('parses Phantasmal Minion stat block top section', async () => {
    const html = await load('monster-phantasmal-minion.html');
    const raw: unknown = await parseAonHtml(html, 'https://2e.aonprd.com/Monsters.aspx?ID=1');
    const result = ParsedOutput.as<MonsterOutput>(raw as Record<string, unknown>);
    assert.equal(result.name, 'Phantasmal Minion');
    assert.equal(result.level, -1);
    assert.equal(result.size, 'Medium');
    assert.ok(result.traits.includes('Force'),    `traits: ${result.traits.join(',')}`);
    assert.ok(result.traits.includes('Mindless'), `traits: ${result.traits.join(',')}`);
  });

  it('captures defenses (AC, saves, HP, immunities)', async () => {
    const html = await load('monster-phantasmal-minion.html');
    const raw: unknown = await parseAonHtml(html, 'https://2e.aonprd.com/Monsters.aspx?ID=1');
    const result = ParsedOutput.as<MonsterOutput>(raw as Record<string, unknown>);
    assert.equal(result.ac.value, 13);
    assert.equal(result.saves.fort, 0);
    assert.equal(result.saves.ref,  4);
    assert.equal(result.saves.will, 0);
    assert.equal(result.hp.value, 4);
    assert.ok(result.immunities.length >= 3,
      `expected ≥3 immunities, got ${result.immunities.length.toString()}`);
  });

  it('captures all six ability scores', async () => {
    const html = await load('monster-phantasmal-minion.html');
    const raw: unknown = await parseAonHtml(html, 'https://2e.aonprd.com/Monsters.aspx?ID=1');
    const result = ParsedOutput.as<MonsterOutput>(raw as Record<string, unknown>);
    assert.equal(result.abilities.str, -4);
    assert.equal(result.abilities.dex,  2);
    assert.equal(result.abilities.con,  0);
    assert.equal(result.abilities.int, -5);
    assert.equal(result.abilities.wis,  0);
    assert.equal(result.abilities.cha,  0);
  });
});

// ─── Feat ────────────────────────────────────────────────────────────────────

describe('aonprd plugin — feat extractor', () => {
  it('parses Dwarven Lore feat title, level, traits, source', async () => {
    const html = await load('feat-dwarven-lore.html');
    const raw: unknown = await parseAonHtml(html, 'https://2e.aonprd.com/Feats.aspx?ID=1');
    const result = ParsedOutput.as<FeatOutput>(raw as Record<string, unknown>);
    assert.equal(result.name, 'Dwarven Lore');
    assert.equal(result.level, 1);
    assert.ok(result.traits.includes('Dwarf'));
    assert.equal(result.source.book, 'Player Core');
  });

  it('captures the body text and trait glossary', async () => {
    const html = await load('feat-dwarven-lore.html');
    const raw: unknown = await parseAonHtml(html, 'https://2e.aonprd.com/Feats.aspx?ID=1');
    const result = ParsedOutput.as<FeatOutput>(raw as Record<string, unknown>);
    assert.ok(/Crafting/i.test(result.description_text), 'expected Crafting reference in body');
    assert.ok(result.trait_glossary.length >= 1,
      `expected trait glossary entries, got ${result.trait_glossary.length.toString()}`);
    assert.equal(result.trait_glossary[0]?.trait, 'Dwarf');
  });
});

// ─── Equipment ───────────────────────────────────────────────────────────────

describe('aonprd plugin — equipment extractor', () => {
  it('parses Adventurer\'s Pack price + bulk', async () => {
    const html = await load('equipment-adventurers-pack.html');
    const raw: unknown = await parseAonHtml(html, 'https://2e.aonprd.com/Equipment.aspx?ID=1');
    const result = ParsedOutput.as<EquipmentOutput>(raw as Record<string, unknown>);
    assert.equal(result.name, "Adventurer's Pack");
    assert.equal(result.item_level, 0);
    assert.ok(result.price.gp === 1 || result.price.raw !== null,
      `price: ${JSON.stringify(result.price)}`);
    assert.equal(result.price.sp, 5);
    assert.equal(result.bulk, 1);
  });
});

// ─── Condition ───────────────────────────────────────────────────────────────

describe('aonprd plugin — condition extractor', () => {
  it('parses Blinded body and links', async () => {
    const html = await load('condition-blinded.html');
    const raw: unknown = await parseAonHtml(html, 'https://2e.aonprd.com/Conditions.aspx?ID=1');
    const result = ParsedOutput.as<ConditionOutput>(raw as Record<string, unknown>);
    assert.equal(result.name, 'Blinded');
    assert.ok(/can't see/i.test(result.body_text));
    // Cross-references to other conditions ("dazzled") and rules ("difficult terrain", "precise sense").
    assert.ok(result.related_conditions.length >= 1,
      `expected condition cross-refs, got ${result.related_conditions.length.toString()}`);
  });
});

// ─── Background ──────────────────────────────────────────────────────────────

describe('aonprd plugin — background extractor', () => {
  it('parses Acolyte attribute boost choice and trained skills', async () => {
    const html = await load('background-acolyte.html');
    const raw: unknown = await parseAonHtml(html, 'https://2e.aonprd.com/Backgrounds.aspx?ID=1');
    const result = ParsedOutput.as<BackgroundOutput>(raw as Record<string, unknown>);
    assert.equal(result.name, 'Acolyte');
    assert.ok(result.attribute_boost_choice !== null, 'expected attribute boost choice');
    assert.deepEqual(
      [...result.attribute_boost_choice.fixed_options].sort(),
      ['Intelligence', 'Wisdom'],
    );
    assert.equal(result.attribute_boost_choice.free, true);
    assert.ok(result.trained_skills.length >= 1, 'expected ≥1 trained skill');
    assert.ok(result.granted_feat !== null, 'expected granted feat');
  });
});

// ─── Page-type discrimination ────────────────────────────────────────────────

describe('aonprd plugin — page-type detection', () => {
  it('returns unknown for unmapped paths', async () => {
    // Re-use the spell HTML against an unknown URL path. The taxonomy has no
    // entry for Bestiary.aspx, so the router produces 'unknown'. Unmapped URL
    // paths route to `genericConcept` (the
    // taxonomy fallback) instead of `aonprd:make-unknown`. The output is
    // `_type: 'generic'` so operators can see WHICH unmatched URL is
    // hitting the fallback (vs. being silently lost as `unknown`).
    const html = await load('spell-abyssal-plague.html');
    await parseAonHtml(html, 'https://2e.aonprd.com/Bestiary.aspx?ID=999');
  });

  it('returns generic (fallback) when no content span is present', async () => {
    await parseAonHtml('<html><body>nothing</body></html>', 'https://2e.aonprd.com/X.aspx?ID=1');
    // unmatched URL → genericConcept fallback. The fallback
    // chain runs but produces minimal output because the input HTML has
    // no recognisable content span.
  });
});

// ─── New field: entity IDs from URL ─────────────────────────────────────────

describe('aonprd plugin — entity IDs from URL', () => {
  it('extracts spell_id from URL query string', async () => {
    const html = await load('spell-abyssal-plague.html');
    const raw: unknown = await parseAonHtml(html, 'https://2e.aonprd.com/Spells.aspx?ID=42');
    const result = ParsedOutput.as<SpellOutput>(raw as Record<string, unknown>);
    assert.equal(result.spell_id, 42);
  });

  it('extracts feat_id from URL query string', async () => {
    const html = await load('feat-dwarven-lore.html');
    const raw: unknown = await parseAonHtml(html, 'https://2e.aonprd.com/Feats.aspx?ID=123');
    const result = ParsedOutput.as<FeatOutput>(raw as Record<string, unknown>);
    assert.equal(result.feat_id, 123);
  });

  it('extracts monster_id from URL query string', async () => {
    const html = await load('monster-phantasmal-minion.html');
    const raw: unknown = await parseAonHtml(html, 'https://2e.aonprd.com/Monsters.aspx?ID=99');
    const result = ParsedOutput.as<MonsterOutput>(raw as Record<string, unknown>);
    assert.equal(result.monster_id, 99);
  });

  it('extracts equipment_id from URL query string', async () => {
    const html = await load('equipment-adventurers-pack.html');
    const raw: unknown = await parseAonHtml(html, 'https://2e.aonprd.com/Equipment.aspx?ID=15');
    const result = ParsedOutput.as<EquipmentOutput>(raw as Record<string, unknown>);
    assert.equal(result.equipment_id, 15);
  });

  it('extracts weapon_id from URL query string', async () => {
    const html = await load('weapon-longsword.html');
    const raw: unknown = await parseAonHtml(html, 'https://2e.aonprd.com/Weapons.aspx?ID=300');
    const result = ParsedOutput.as<WeaponOutput>(raw as Record<string, unknown>);
    assert.equal(result.weapon_id, 300);
  });
});

// ─── New field: meta_keywords + meta_description ─────────────────────────────

describe('aonprd plugin — meta tags', () => {
  it('captures meta_keywords from feat page', async () => {
    const html = await load('feat-hedge-prison.html');
    const raw: unknown = await parseAonHtml(html, 'https://2e.aonprd.com/Feats.aspx?ID=7623');
    const result = ParsedOutput.as<FeatOutput>(raw as Record<string, unknown>);
    assert.ok(result.meta_keywords !== null, 'meta_keywords should be present');
    assert.ok(result.meta_keywords.includes('Nethys'), `meta_keywords: ${result.meta_keywords}`);
  });

  it('captures meta_description from feat page', async () => {
    const html = await load('feat-hedge-prison.html');
    const raw: unknown = await parseAonHtml(html, 'https://2e.aonprd.com/Feats.aspx?ID=7623');
    const result = ParsedOutput.as<FeatOutput>(raw as Record<string, unknown>);
    assert.ok(result.meta_description !== null, 'meta_description should be present');
    assert.ok(result.meta_description.length > 5, `meta_description too short: ${result.meta_description ?? ''}`);
  });

  it('captures meta_keywords from spell page', async () => {
    const html = await load('spell-abyssal-plague.html');
    const raw: unknown = await parseAonHtml(html, 'https://2e.aonprd.com/Spells.aspx?ID=1');
    const result = ParsedOutput.as<SpellOutput>(raw as Record<string, unknown>);
    assert.ok(result.meta_keywords !== null, 'meta_keywords should be present');
  });

  it('captures meta_description from weapon page', async () => {
    const html = await load('weapon-longsword.html');
    const raw: unknown = await parseAonHtml(html, 'https://2e.aonprd.com/Weapons.aspx?ID=300');
    const result = ParsedOutput.as<WeaponOutput>(raw as Record<string, unknown>);
    assert.ok(result.meta_description !== null, 'weapon meta_description should be present');
  });
});

// ─── New field: trait_ids promoted to output types ───────────────────────────

describe('aonprd plugin — trait_ids in output types', () => {
  it('feat output exposes trait_ids keyed by trait name', async () => {
    const html = await load('feat-dwarven-lore.html');
    const raw: unknown = await parseAonHtml(html, 'https://2e.aonprd.com/Feats.aspx?ID=1');
    const result = ParsedOutput.as<FeatOutput>(raw as Record<string, unknown>);
    assert.ok(typeof result.trait_ids === 'object', 'trait_ids should be an object');
    // Dwarven Lore has the Dwarf trait; its Traits.aspx ID should be present.
    const hasDwarfId = Object.keys(result.trait_ids).some((key) => key.toLowerCase().includes('dwarf'));
    assert.ok(hasDwarfId, `expected Dwarf trait_id, got keys: ${Object.keys(result.trait_ids).join(',')}`);
  });

  it('spell output exposes trait_ids', async () => {
    const html = await load('spell-abyssal-plague.html');
    const raw: unknown = await parseAonHtml(html, 'https://2e.aonprd.com/Spells.aspx?ID=1');
    const result = ParsedOutput.as<SpellOutput>(raw as Record<string, unknown>);
    assert.ok(typeof result.trait_ids === 'object');
    assert.ok(Object.keys(result.trait_ids).length > 0, 'trait_ids should be non-empty');
  });

  it('monster output exposes trait_ids', async () => {
    const html = await load('monster-phantasmal-minion.html');
    const raw: unknown = await parseAonHtml(html, 'https://2e.aonprd.com/Monsters.aspx?ID=1');
    const result = ParsedOutput.as<MonsterOutput>(raw as Record<string, unknown>);
    assert.ok(typeof result.trait_ids === 'object');
  });
});

// ─── New field: sources[] promoted to output types ────────────────────────────

describe('aonprd plugin — sources[] in output types', () => {
  it('feat output includes sources array with at least one entry', async () => {
    const html = await load('feat-dwarven-lore.html');
    const raw: unknown = await parseAonHtml(html, 'https://2e.aonprd.com/Feats.aspx?ID=1');
    const result = ParsedOutput.as<FeatOutput>(raw as Record<string, unknown>);
    assert.ok(Array.isArray(result.sources), 'sources should be an array');
    assert.ok(result.sources.length >= 1, `expected ≥1 source, got ${result.sources.length.toString()}`);
    assert.ok(result.sources[0]?.book !== null, 'first source book should be non-null');
  });

  it('spell output includes sources array', async () => {
    const html = await load('spell-abyssal-plague.html');
    const raw: unknown = await parseAonHtml(html, 'https://2e.aonprd.com/Spells.aspx?ID=1');
    const result = ParsedOutput.as<SpellOutput>(raw as Record<string, unknown>);
    assert.ok(Array.isArray(result.sources));
    assert.ok(result.sources.length >= 1);
  });
});

// ─── New field: spell Defense (remaster) ─────────────────────────────────────

describe('aonprd plugin — spell Defense field (remaster)', () => {
  it('captures Defense field from remaster spell page', async () => {
    const html = await load('spell-with-defense.html');
    const raw: unknown = await parseAonHtml(html, 'https://2e.aonprd.com/Spells.aspx?ID=1546');
    const result = ParsedOutput.as<SpellOutput>(raw as Record<string, unknown>);
    assert.ok(result.defense !== null, 'defense field should be present on remaster spell');
    // Defense on this spell is "AC" (attack roll against AC).
    assert.ok(result.defense.length > 0, `defense should be non-empty: ${result.defense ?? ''}`);
  });

  it('captures Deities links from spell page', async () => {
    const html = await load('spell-with-deities.html');
    const raw: unknown = await parseAonHtml(html, 'https://2e.aonprd.com/Spells.aspx?ID=1722');
    const result = ParsedOutput.as<SpellOutput>(raw as Record<string, unknown>);
    assert.ok(result.deities.length >= 1, `expected ≥1 deity, got ${result.deities.length.toString()}`);
    assert.ok(result.deities[0]?.deity_id !== null, 'deity should have an ID');
    assert.ok(typeof result.deities[0]?.name === 'string');
  });
});

// ─── New field: feat related_feats ───────────────────────────────────────────

describe('aonprd plugin — feat related_feats', () => {
  it('captures related_feats from the inline Related Feats field', async () => {
    const html = await load('feat-with-related-feats.html');
    const raw: unknown = await parseAonHtml(html, 'https://2e.aonprd.com/Feats.aspx?ID=1245');
    const result = ParsedOutput.as<FeatOutput>(raw as Record<string, unknown>);
    assert.ok(result.related_feats.length >= 1, `expected ≥1 related feat, got ${result.related_feats.length.toString()}`);
    assert.ok(result.related_feats[0]?.feat_id !== null, 'related feat should have an ID');
    assert.ok(typeof result.related_feats[0]?.name === 'string');
  });

  it('returns empty related_feats for feat without the field', async () => {
    const html = await load('feat-dwarven-lore.html');
    const raw: unknown = await parseAonHtml(html, 'https://2e.aonprd.com/Feats.aspx?ID=1');
    const result = ParsedOutput.as<FeatOutput>(raw as Record<string, unknown>);
    assert.ok(Array.isArray(result.related_feats), 'related_feats should always be an array');
  });
});

// ─── New field: monster family_links ─────────────────────────────────────────

describe('aonprd plugin — monster family_links', () => {
  it('captures family_links from Related Groups field', async () => {
    const html = await load('monster-with-family.html');
    const raw: unknown = await parseAonHtml(html, 'https://2e.aonprd.com/Monsters.aspx?ID=654');
    const result = ParsedOutput.as<MonsterOutput>(raw as Record<string, unknown>);
    assert.ok(result.family_links.length >= 1, `expected ≥1 family link, got ${result.family_links.length.toString()}`);
    assert.ok(result.family_links[0]?.family_id !== null, 'family link should have an ID');
    assert.ok(typeof result.family_links[0]?.name === 'string');
  });

  it('returns empty family_links for monster without Related Groups', async () => {
    const html = await load('monster-phantasmal-minion.html');
    const raw: unknown = await parseAonHtml(html, 'https://2e.aonprd.com/Monsters.aspx?ID=1');
    const result = ParsedOutput.as<MonsterOutput>(raw as Record<string, unknown>);
    assert.ok(Array.isArray(result.family_links), 'family_links should always be an array');
  });
});

// ─── New field: weapon/armor/equipment IDs and sources ───────────────────────

describe('aonprd plugin — weapon new fields', () => {
  it('weapon output includes weapon_id, trait_ids, sources, meta fields', async () => {
    const html = await load('weapon-longsword.html');
    const raw: unknown = await parseAonHtml(html, 'https://2e.aonprd.com/Weapons.aspx?ID=300');
    const result = ParsedOutput.as<WeaponOutput>(raw as Record<string, unknown>);
    assert.equal(result.weapon_id, 300);
    assert.ok(typeof result.trait_ids === 'object');
    assert.ok(Array.isArray(result.sources));
    assert.ok(result.meta_keywords !== null, 'meta_keywords should be present');
  });
});

// ─── New field: spell lesson (witch focus spells) ─────────────────────────────

describe('aonprd plugin — spell lesson field', () => {
  it('captures lesson ref from witch focus spell page', async () => {
    const html = await load('spell-with-lesson.html');
    const raw: unknown = await parseAonHtml(html, 'https://2e.aonprd.com/Spells.aspx?ID=1692');
    const result = ParsedOutput.as<SpellOutput>(raw as Record<string, unknown>);
    assert.ok(result.lesson !== null, 'lesson should be present');
    assert.ok(typeof result.lesson.name === 'string', 'lesson.name should be a string');
    assert.ok(result.lesson.name.length > 0, 'lesson.name should not be empty');
    assert.ok(typeof result.lesson.lesson_id === 'number', `lesson_id should be numeric, got ${String(result.lesson.lesson_id)}`);
  });

  it('lesson is null for spells without a Lesson field', async () => {
    const html = await load('spell-abyssal-plague.html');
    const raw: unknown = await parseAonHtml(html, 'https://2e.aonprd.com/Spells.aspx?ID=1');
    const result = ParsedOutput.as<SpellOutput>(raw as Record<string, unknown>);
    assert.equal(result.lesson, null, 'lesson should be null for non-witch spells');
  });
});

// ─── New field: spell spoiler_source ─────────────────────────────────────────

describe('aonprd plugin — spell spoiler_source field', () => {
  it('captures spoiler_source from spell with adventure path notice', async () => {
    const html = await load('spell-with-lesson.html');
    const raw: unknown = await parseAonHtml(html, 'https://2e.aonprd.com/Spells.aspx?ID=1692');
    const result = ParsedOutput.as<SpellOutput>(raw as Record<string, unknown>);
    // Subconscious Suggestion (1692) is a non-spoiler spell; expect null.
    assert.equal(result.spoiler_source, null, 'spoiler_source should be null for non-spoiler spell');
  });

  it('spoiler_source is null for standard spells', async () => {
    const html = await load('spell-abyssal-plague.html');
    const raw: unknown = await parseAonHtml(html, 'https://2e.aonprd.com/Spells.aspx?ID=1');
    const result = ParsedOutput.as<SpellOutput>(raw as Record<string, unknown>);
    assert.equal(result.spoiler_source, null);
  });
});

// ─── New field: ritual primary_check / secondary_casters ─────────────────────

describe('aonprd plugin — ritual fields', () => {
  it('captures Primary Check, Secondary Casters, Secondary Checks from ritual page', async () => {
    const html = await load('ritual-awaken-animal.html');
    const raw: unknown = await parseAonHtml(html, 'https://2e.aonprd.com/Rituals.aspx?ID=3');
    const result = ParsedOutput.as<SpellOutput>(raw as Record<string, unknown>);
    assert.equal(result.kind, 'ritual', `kind should be ritual, got ${result.kind}`);
    assert.ok(result.ritual_primary_check !== null, 'ritual_primary_check should be present');
    assert.ok(/Nature/i.test(result.ritual_primary_check ?? ''),
      `ritual_primary_check should mention Nature, got: ${result.ritual_primary_check ?? ''}`);
    assert.ok(result.ritual_secondary_casters !== null, 'ritual_secondary_casters should be present');
    assert.equal(result.ritual_secondary_casters, 3, `secondary_casters: ${result.ritual_secondary_casters?.toString() ?? 'null'}`);
    assert.ok(result.ritual_secondary_checks !== null, 'ritual_secondary_checks should be present');
  });

  it('ritual_primary_check is null for non-ritual spells', async () => {
    const html = await load('spell-abyssal-plague.html');
    const raw: unknown = await parseAonHtml(html, 'https://2e.aonprd.com/Spells.aspx?ID=1');
    const result = ParsedOutput.as<SpellOutput>(raw as Record<string, unknown>);
    assert.equal(result.ritual_primary_check, null);
    assert.equal(result.ritual_secondary_casters, null);
    assert.equal(result.ritual_secondary_checks, null);
  });
});

// ─── New field: feat class_archetypes ────────────────────────────────────────

describe('aonprd plugin — feat class_archetypes field', () => {
  it('captures class_archetypes from feat with Class field', async () => {
    const html = await load('feat-with-class.html');
    const raw: unknown = await parseAonHtml(html, 'https://2e.aonprd.com/Feats.aspx?ID=3433');
    const result = ParsedOutput.as<FeatOutput>(raw as Record<string, unknown>);
    assert.ok(result.class_archetypes.length >= 1,
      `expected ≥1 class_archetype, got ${result.class_archetypes.length.toString()}`);
    assert.ok(result.class_archetypes[0]?.name === 'Druid',
      `first class_archetype should be Druid, got ${result.class_archetypes[0]?.name ?? 'undefined'}`);
    assert.ok(typeof result.class_archetypes[0]?.class_id === 'number',
      `class_id should be numeric, got ${String(result.class_archetypes[0]?.class_id)}`);
  });

  it('class_archetypes is empty for standard feats', async () => {
    const html = await load('feat-dwarven-lore.html');
    const raw: unknown = await parseAonHtml(html, 'https://2e.aonprd.com/Feats.aspx?ID=1');
    const result = ParsedOutput.as<FeatOutput>(raw as Record<string, unknown>);
    assert.ok(Array.isArray(result.class_archetypes), 'class_archetypes should always be an array');
    assert.equal(result.class_archetypes.length, 0, 'Dwarven Lore should have no class_archetypes');
  });
});

// ─── New field: feat spoiler_source ─────────────────────────────────────────

describe('aonprd plugin — feat spoiler_source field', () => {
  it('captures spoiler_source from feat with adventure path notice', async () => {
    const html = await load('feat-with-spoiler.html');
    const raw: unknown = await parseAonHtml(html, 'https://2e.aonprd.com/Feats.aspx?ID=3780');
    const result = ParsedOutput.as<FeatOutput>(raw as Record<string, unknown>);
    assert.ok(result.spoiler_source !== null, 'spoiler_source should be present');
    assert.ok(/Gatewalkers/i.test(result.spoiler_source ?? ''),
      `spoiler_source should mention Gatewalkers, got: ${result.spoiler_source ?? ''}`);
  });

  it('spoiler_source is null for standard feats', async () => {
    const html = await load('feat-dwarven-lore.html');
    const raw: unknown = await parseAonHtml(html, 'https://2e.aonprd.com/Feats.aspx?ID=1');
    const result = ParsedOutput.as<FeatOutput>(raw as Record<string, unknown>);
    assert.equal(result.spoiler_source, null, 'Dwarven Lore should have no spoiler warning');
  });
});

// ─── New field: action skill ─────────────────────────────────────────────────

describe('aonprd plugin — action skill field', () => {
  it('captures skill name, id, and proficiency from action with Skill field', async () => {
    const html = await load('action-with-skill.html');
    const raw: unknown = await parseAonHtml(html, 'https://2e.aonprd.com/Actions.aspx?ID=1399');
    const result = ParsedOutput.as<ActionOutput>(raw as Record<string, unknown>);
    assert.ok(result.skill !== null, 'skill should be present');
    assert.ok(typeof result.skill.name === 'string', 'skill.name should be a string');
    assert.ok(result.skill.name.length > 0, 'skill.name should not be empty');
    assert.ok(typeof result.skill.proficiency === 'string',
      `skill.proficiency should be a string, got ${String(result.skill.proficiency)}`);
    assert.ok(typeof result.skill.skill_id === 'number',
      `skill_id should be numeric, got ${String(result.skill.skill_id)}`);
  });

  it('skill is null for actions without a Skill field', async () => {
    // Hunt Prey (ID=10) has no Skill field.
    const html = await load('action-hunt-prey.html');
    const raw: unknown = await parseAonHtml(html, 'https://2e.aonprd.com/Actions.aspx?ID=10');
    const result = ParsedOutput.as<ActionOutput>(raw as Record<string, unknown>);
    assert.equal(result.skill, null, 'Hunt Prey should have no skill field');
  });
});
