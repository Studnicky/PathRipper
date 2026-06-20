// Unit tests for the AON monster extractor — `plugins/aonprd/monster.ts`.
// Verifies new and fixed fields against sampled raw HTML fixtures.
// Fixtures are copied from output-live/aonprd/aonprd/raw/ (real scraped pages).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseAonHtml } from '../../../../plugins/aonprd/parse.task.js';
import type { MonsterOutput } from '../../../../plugins/aonprd/concepts/monster/concept.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function load(name: string): Promise<string> {
  return readFile(resolve(__dirname, '../../../e2e/plugins/fixtures/aonprd', name), 'utf-8');
}

async function loadMonster(fixture: string, url: string): Promise<MonsterOutput> {
  const html = await load(fixture);
  return (await parseAonHtml(html, url)) as unknown as MonsterOutput;
}

// ─── is_legacy ───────────────────────────────────────────────────────────────

describe('monster extractor — is_legacy', () => {
  it('is_legacy is true for legacy (OGL) content with legacy-content-warning heading', async () => {
    // Goblin War Chanter — Bestiary (legacy), has <h3 class="title legacy-content-warning">
    const monster = await loadMonster('monster-goblin-war-chanter.html', 'https://2e.aonprd.com/Monsters.aspx?ID=235');
    assert.equal(monster.is_legacy, true, 'Goblin War Chanter (OGL) should be flagged as legacy');
  });

  it('is_legacy is false for remaster content', async () => {
    // Bikkhasura — Monster Core 2 (remaster), no legacy-content-warning
    const monster = await loadMonster('monster-with-regeneration.html', 'https://2e.aonprd.com/Monsters.aspx?ID=4088');
    assert.equal(monster.is_legacy, false, 'Bikkhasura (remaster) should not be flagged as legacy');
  });
});

// ─── creature_art ─────────────────────────────────────────────────────────────

describe('monster extractor — creature_art', () => {
  it('captures creature_art URL when monster-art-link is present', async () => {
    // Bikkhasura has <a class="monster-art-link" href="Images\Monsters\Asura_Bikkhasura.webp">
    const monster = await loadMonster('monster-with-regeneration.html', 'https://2e.aonprd.com/Monsters.aspx?ID=4088');
    assert.ok(monster.creature_art !== null, 'creature_art should be non-null when monster-art-link is present');
    assert.ok(
      /Asura_Bikkhasura/i.test(monster.creature_art ?? ''),
      `creature_art should reference Bikkhasura image, got: ${monster.creature_art ?? 'null'}`,
    );
  });

  it('returns null for creature_art when no illustration link is present', async () => {
    // Goblin War Chanter (legacy) — no monster-art-link
    const monster = await loadMonster('monster-goblin-war-chanter.html', 'https://2e.aonprd.com/Monsters.aspx?ID=235');
    assert.equal(monster.creature_art, null, 'legacy monster without art link should have null creature_art');
  });
});

// ─── flavor_text ──────────────────────────────────────────────────────────────

describe('monster extractor — flavor_text', () => {
  it('captures flavor_text from hide-on-print lore span', async () => {
    // Goblin War Chanter has lore text in <span class="hide-on-print">
    const monster = await loadMonster('monster-goblin-war-chanter.html', 'https://2e.aonprd.com/Monsters.aspx?ID=235');
    assert.ok(monster.flavor_text !== null, 'flavor_text should be present');
    assert.ok(
      /goblin/i.test(monster.flavor_text ?? ''),
      `flavor_text should mention goblins, got: ${(monster.flavor_text ?? '').slice(0, 80)}`,
    );
  });

  it('captures flavor_text for remaster monster', async () => {
    // Bikkhasura has lore text
    const monster = await loadMonster('monster-with-regeneration.html', 'https://2e.aonprd.com/Monsters.aspx?ID=4088');
    assert.ok(monster.flavor_text !== null, 'Bikkhasura should have flavor_text');
    assert.ok(
      /asura|reincarnated/i.test(monster.flavor_text ?? ''),
      `flavor_text unexpected: ${(monster.flavor_text ?? '').slice(0, 80)}`,
    );
  });
});

// ─── recall_knowledge (fixed extraction) ─────────────────────────────────────

describe('monster extractor — recall_knowledge', () => {
  it('extracts recall_knowledge DC and lore pair for legacy monster', async () => {
    // HTML: <b><u><a href="…">Recall Knowledge</a></u></b> DC 15 • Humanoid (Society)
    const monster = await loadMonster('monster-goblin-war-chanter.html', 'https://2e.aonprd.com/Monsters.aspx?ID=235');
    assert.equal(monster.recall_knowledge.dc, 15, 'Goblin War Chanter recall DC should be 15');
    assert.equal(monster.recall_knowledge.lores.length, 1, 'should have 1 lore entry');
    assert.equal(monster.recall_knowledge.lores[0]?.trait, 'Humanoid');
    assert.equal(monster.recall_knowledge.lores[0]?.skill, 'Society');
  });

  it('extracts recall_knowledge DC only (no lores) for minion-type monster', async () => {
    // Phantasmal Minion: <b><u><a>Recall Knowledge</a></u></b> DC 13 (no bullet lores)
    const monster = await loadMonster('monster-phantasmal-minion.html', 'https://2e.aonprd.com/Monsters.aspx?ID=2750');
    assert.equal(monster.recall_knowledge.dc, 13, 'Phantasmal Minion recall DC should be 13');
    assert.equal(monster.recall_knowledge.lores.length, 0, 'should have no lore entries');
  });

  it('extracts recall_knowledge with high DC for high-CR monster', async () => {
    // Bikkhasura: DC 40 • Spirit (Occultism)
    const monster = await loadMonster('monster-with-regeneration.html', 'https://2e.aonprd.com/Monsters.aspx?ID=4088');
    assert.equal(monster.recall_knowledge.dc, 40, 'Bikkhasura recall DC should be 40');
    assert.equal(monster.recall_knowledge.lores.length, 1);
    assert.equal(monster.recall_knowledge.lores[0]?.trait, 'Spirit');
    assert.equal(monster.recall_knowledge.lores[0]?.skill, 'Occultism');
  });
});

// ─── strikes (fixed extraction) ───────────────────────────────────────────────

describe('monster extractor — strikes', () => {
  it('correctly parses melee strike weapon name and attack bonus', async () => {
    // Goblin War Chanter: dogslicer +8 [+4/+0] (agile, backstabber, finesse), Damage 1d6+2 slashing
    const monster = await loadMonster('monster-goblin-war-chanter.html', 'https://2e.aonprd.com/Monsters.aspx?ID=235');
    const melee = monster.strikes.find((strike) => strike.kind === 'melee');
    assert.ok(melee !== undefined, 'should have a melee strike');
    assert.equal(melee.weapon, 'dogslicer');
    assert.equal(melee.attack_bonus, 8);
    assert.deepEqual(melee.map_bonuses, [4, 0]);
    assert.ok(melee.traits.includes('agile'), `traits should include agile: ${melee.traits.join(',')}`);
  });

  it('correctly parses ranged strike weapon name and attack bonus', async () => {
    // Goblin War Chanter: shortbow +8 [+3/-2] (deadly 1d10, range 60 ft, reload 0), Damage 1d6 piercing
    const monster = await loadMonster('monster-goblin-war-chanter.html', 'https://2e.aonprd.com/Monsters.aspx?ID=235');
    const ranged = monster.strikes.find((strike) => strike.kind === 'ranged');
    assert.ok(ranged !== undefined, 'should have a ranged strike');
    assert.equal(ranged.weapon, 'shortbow');
    assert.equal(ranged.attack_bonus, 8);
    assert.deepEqual(ranged.map_bonuses, [3, -2]);
  });

  it('parses damage dice and type for each strike', async () => {
    const monster = await loadMonster('monster-goblin-war-chanter.html', 'https://2e.aonprd.com/Monsters.aspx?ID=235');
    const melee = monster.strikes.find((strike) => strike.kind === 'melee');
    assert.ok(melee !== undefined);
    assert.equal(melee.damage.length, 1, 'should have 1 damage entry');
    assert.equal(melee.damage[0]?.dice, '1d6+2');
    assert.ok(/slashing/i.test(melee.damage[0]?.type ?? ''), `damage type: ${melee.damage[0]?.type ?? ''}`);
  });

  it('parses multiple strikes for high-CR monster', async () => {
    // Young Red Dragon: jaws, claw, tail, wing — 4 melee strikes
    const monster = await loadMonster('monster-young-red-dragon.html', 'https://2e.aonprd.com/Monsters.aspx?ID=136');
    assert.ok(monster.strikes.length >= 3, `expected ≥3 strikes, got ${monster.strikes.length.toString()}`);
    const jaws = monster.strikes.find((strike) => strike.weapon === 'jaws');
    assert.ok(jaws !== undefined, 'should have jaws strike');
    assert.equal(jaws.attack_bonus, 23);
    // Jaws damage: 2d12+12 piercing plus 2d6 fire
    assert.ok(jaws.damage.length >= 2, `jaws should have ≥2 damage entries, got ${jaws.damage.length.toString()}`);
  });

  it('parses spirit needle strike for monster with spiritual weapons', async () => {
    // Bikkhasura: spirit blade +37 [+32/+27]
    const monster = await loadMonster('monster-with-regeneration.html', 'https://2e.aonprd.com/Monsters.aspx?ID=4088');
    const strike = monster.strikes[0];
    assert.ok(strike !== undefined, 'should have at least one strike');
    assert.ok(strike.attack_bonus !== null && strike.attack_bonus >= 30,
      `attack bonus should be ≥30, got ${strike.attack_bonus?.toString() ?? 'null'}`);
  });
});

// ─── hp.special (regeneration / fast healing) ────────────────────────────────

describe('monster extractor — hp.special for regeneration', () => {
  it('captures regeneration text in hp.special', async () => {
    // Bikkhasura: HP 380, regeneration 20 (deactivated by holy)
    const monster = await loadMonster('monster-with-regeneration.html', 'https://2e.aonprd.com/Monsters.aspx?ID=4088');
    assert.equal(monster.hp.value, 380);
    assert.ok(monster.hp.special !== null, 'hp.special should be non-null for regenerating monster');
    assert.ok(
      /regeneration\s+20/i.test(monster.hp.special ?? ''),
      `hp.special should mention "regeneration 20", got: ${monster.hp.special ?? 'null'}`,
    );
  });

  it('hp.special is null for standard HP with no special clause', async () => {
    // Goblin War Chanter: HP 16 (no regeneration)
    const monster = await loadMonster('monster-goblin-war-chanter.html', 'https://2e.aonprd.com/Monsters.aspx?ID=235');
    assert.equal(monster.hp.value, 16);
    assert.equal(monster.hp.special, null, 'plain HP with no extra clause should have null special');
  });
});

// ─── spell_lists (slots now populated) ───────────────────────────────────────

describe('monster extractor — spell_lists slots', () => {
  it('captures spontaneous spell list with ranked slots', async () => {
    // Goblin War Chanter: Occult Spontaneous Spells DC 17, attack +7; 1st bless, soothe; Cantrips …
    const monster = await loadMonster('monster-goblin-war-chanter.html', 'https://2e.aonprd.com/Monsters.aspx?ID=235');
    assert.ok(monster.spell_lists.length >= 1, `expected ≥1 spell list, got ${monster.spell_lists.length.toString()}`);
    const spells = monster.spell_lists.find((spellList) => spellList.kind === 'spells');
    assert.ok(spells !== undefined, 'should have a spells list');
    assert.equal(spells.dc, 17);
    assert.equal(spells.attack, 7);
    // 1st rank slot should include bless
    const firstSlot = spells.slots.find((slot) => slot.rank === '1st');
    assert.ok(firstSlot !== undefined, 'should have 1st rank slot');
    const spellNames = firstSlot.spells.map((spell) => spell.name.toLowerCase());
    assert.ok(spellNames.includes('bless'), `1st slot should include bless: ${spellNames.join(',')}`);
  });

  it('captures ritual list with spell entries', async () => {
    // Monster with rituals: Rituals DC 37; 4th atone; 1st angelic messenger
    const monster = await loadMonster('monster-with-rituals.html', 'https://2e.aonprd.com/Monsters.aspx?ID=4030');
    const rituals = monster.spell_lists.find((spellList) => spellList.kind === 'rituals');
    assert.ok(rituals !== undefined, 'should have a rituals list');
    assert.equal(rituals.dc, 37);
    assert.ok(rituals.slots.length >= 1, `ritual list should have ≥1 slot`);
    // 4th rank contains "atone"
    const fourthSlot = rituals.slots.find((slot) => slot.rank === '4th');
    assert.ok(fourthSlot !== undefined, 'should have 4th rank ritual slot');
    const ritualNames = fourthSlot.spells.map((spell) => spell.name.toLowerCase());
    assert.ok(ritualNames.includes('atone'), `4th ritual slot should include atone: ${ritualNames.join(',')}`);
  });
});

// ─── top_abilities (bare-bold extraction) ────────────────────────────────────

describe('monster extractor — top_abilities bare-bold extraction', () => {
  it('recovers bare-bold "Force Body" ability from phantasmal minion head section', async () => {
    // Phantasmal Minion has <b>Force Body</b> A phantasmal minion's body…<hr/>
    // with no <span class="hanging-indent"> wrapper.
    const monster = await loadMonster('monster-phantasmal-minion.html', 'https://2e.aonprd.com/Monsters.aspx?ID=2750');
    assert.ok(monster.top_abilities.length >= 1,
      `expected ≥1 top ability, got ${monster.top_abilities.length.toString()}`);
    const forceBody = monster.top_abilities.find((ability) => ability.name === 'Force Body');
    assert.ok(forceBody !== undefined, 'should include a Force Body ability');
    assert.ok(/made of magical force/i.test(forceBody.body_text),
      `body_text should mention 'made of magical force', got: ${forceBody.body_text.slice(0, 80)}`);
  });

  it('removes recovered bare-bold ability names from raw_fields', async () => {
    // After the bare-bold pass picks up "Force Body", the orphan key should no
    // longer appear in raw_fields.
    const monster = await loadMonster('monster-phantasmal-minion.html', 'https://2e.aonprd.com/Monsters.aspx?ID=2750');
    assert.equal(monster.raw_fields['Force Body'], undefined,
      'Force Body should not be a raw_fields key after extraction');
  });

  it('recovers bare-bold "Smoke Vision" from young red dragon head section', async () => {
    // Young Red Dragon has <b>Smoke Vision</b> Smoke doesn't impair…<hr/>
    // at the top of the stat block.
    const monster = await loadMonster('monster-young-red-dragon.html', 'https://2e.aonprd.com/Monsters.aspx?ID=136');
    const smokeVision = monster.top_abilities.find((ability) => ability.name === 'Smoke Vision');
    assert.ok(smokeVision !== undefined, 'should include a Smoke Vision ability');
    assert.equal(monster.raw_fields['Smoke Vision'], undefined,
      'Smoke Vision should not be a raw_fields key after extraction');
  });

  it('does not double-count abilities also present as hanging-indent in head', async () => {
    // Sanity check: bare-bold pass filters by name against the hanging-indent
    // pass, so duplicates are not produced. Young Red Dragon top_abilities
    // should have no repeated names.
    const monster = await loadMonster('monster-young-red-dragon.html', 'https://2e.aonprd.com/Monsters.aspx?ID=136');
    const names = monster.top_abilities.map((ability) => ability.name);
    const unique = new Set(names);
    assert.equal(names.length, unique.size,
      `top_abilities should have no duplicate names, got: ${names.join(', ')}`);
  });
});
