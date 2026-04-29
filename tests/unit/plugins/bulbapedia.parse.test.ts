/**
 * Unit tests for the Bulbapedia parse plugin's TCG helpers.
 *
 * Imports the exported pure-function helpers directly; does not go through
 * the full pipeline or TaskRegistry.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  hasTmpl,
  extractExpansions,
  extractTcgPokemonCard,
  extractTcgTrainerCard,
  extractTcgSet,
} from '../../../plugins/bulbapedia/parse.task.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CHARIZARD_BASE4 = `
{{PokémoncardInfobox
| cardname    = Charizard
| jname       = リザードン
| jtrans      = Lizardon
| image       = CharizardBaseSet4.jpg
| caption     = Illus. Mitsuhiro Arita
| species     = Charizard
| evostage    = Stage 2
| type        = Fire
| hp          = 120
| weakness    = Water
| resistance  = Fighting
| retreatcost = 3
}}
{{PokémoncardInfobox/Expansion
| type       = English
| expansion  = {{TCG|Base Set}}
| rarity     = Rare Holo
| cardno     = 4/102
}}
{{PokémoncardInfobox/Expansion
| type       = Japanese
| jpexpansion = {{TCG|Base Set (TCG)}}
| jprarity   = Rare Holo
| jpcardno   = 006/060
}}
[[Category:TCG cards]]
[[Category:Charizard (TCG)]]
`;

const PROFESSOR_ELM = `
{{TCGTrainerCardInfobox
| cardname = Professor Elm
| jname    = ウツギはかせのポケモン研究
| jtrans   = Professor Utsugi's Pokémon Research
| image    = ProfessorElmNeoGenesis96.jpg
| class    = Old Trainer
}}
{{TCGTrainerCardInfobox/Expansion
| type      = English
| expansion = {{TCG|Neo Genesis}}
| rarity    = Uncommon
| cardno    = 96/111
}}
{{TCGTrainerCardInfobox/Expansion
| type      = Japanese
| expansion = {{TCG|Gold, Silver, to a New World...}}
| rarity    = Uncommon
| cardno    = 101/103
}}
[[Category:TCG Trainer cards]]
`;

const BRILLIANT_STARS = `
{{TCGExpansionInfobox
| setname      = Sword & Shield—Brilliant Stars
| jasetname    = スターバース
| transsetname = Star Birth
| setsymbol    = BrilliantStars
| setlogo      = BST Logo EN.png
| encards      = 216
| ensetnum     = 9
| enrelease    = February 25, 2022
| jacards      = 100
| jasetnum     = 1
| jarelease    = January 28, 2022
}}
[[Category:TCG expansions]]
`;

const REDIRECT_PAGE = `#REDIRECT [[Charizard (Base Set 4)]]`;

const UNKNOWN_PAGE = `
== Pokémon TCG ==
Some random page with no recognised infobox.
[[Category:Unknown]]
`;

// ─── hasTmpl ─────────────────────────────────────────────────────────────────

describe('hasTmpl', () => {
  it('returns true when template name is present (exact case)', () => {
    assert.equal(hasTmpl(CHARIZARD_BASE4, 'PokémoncardInfobox'), true);
  });

  it('returns true when template name present (case-insensitive)', () => {
    assert.equal(hasTmpl(CHARIZARD_BASE4, 'pokémoncardInfobox'), true);
  });

  it('returns true for TCGTrainerCardInfobox', () => {
    assert.equal(hasTmpl(PROFESSOR_ELM, 'TCGTrainerCardInfobox'), true);
  });

  it('returns true for TCGExpansionInfobox', () => {
    assert.equal(hasTmpl(BRILLIANT_STARS, 'TCGExpansionInfobox'), true);
  });

  it('returns false when template is absent', () => {
    assert.equal(hasTmpl(UNKNOWN_PAGE, 'PokémoncardInfobox'), false);
  });

  it('returns false on empty wikitext', () => {
    assert.equal(hasTmpl('', 'PokémoncardInfobox'), false);
  });

  it('is case-insensitive for the trainer template', () => {
    assert.equal(hasTmpl(PROFESSOR_ELM, 'tcgtrainercardInfobox'), true);
  });

  it('is case-insensitive for the expansion template', () => {
    assert.equal(hasTmpl(BRILLIANT_STARS, 'tcgexpansioninfobox'), true);
  });
});

// ─── extractExpansions ────────────────────────────────────────────────────────

describe('extractExpansions', () => {
  it('extracts two expansion entries for Charizard', () => {
    const result = extractExpansions(CHARIZARD_BASE4, 'PokémoncardInfobox');
    assert.equal(result.length, 2);
  });

  it('first expansion has "Base Set" as expansion name', () => {
    const result = extractExpansions(CHARIZARD_BASE4, 'PokémoncardInfobox');
    assert.equal(result[0]?.expansion, 'Base Set');
  });

  it('first expansion has correct card number', () => {
    const result = extractExpansions(CHARIZARD_BASE4, 'PokémoncardInfobox');
    assert.equal(result[0]?.card_number, '4/102');
  });

  it('first expansion has correct rarity', () => {
    const result = extractExpansions(CHARIZARD_BASE4, 'PokémoncardInfobox');
    assert.equal(result[0]?.rarity, 'Rare Holo');
  });

  it('second expansion has a card number (JP)', () => {
    const result = extractExpansions(CHARIZARD_BASE4, 'PokémoncardInfobox');
    // jpcardno fallback
    assert.ok(result[1]?.card_number !== null, 'expected a non-null JP card number');
  });

  it('extracts two expansion entries for Professor Elm', () => {
    const result = extractExpansions(PROFESSOR_ELM, 'TCGTrainerCardInfobox');
    assert.equal(result.length, 2);
  });

  it('Professor Elm first expansion is Neo Genesis', () => {
    const result = extractExpansions(PROFESSOR_ELM, 'TCGTrainerCardInfobox');
    assert.equal(result[0]?.expansion, 'Neo Genesis');
  });

  it('Professor Elm first expansion rarity is Uncommon', () => {
    const result = extractExpansions(PROFESSOR_ELM, 'TCGTrainerCardInfobox');
    assert.equal(result[0]?.rarity, 'Uncommon');
  });

  it('returns empty array when no expansion sub-templates exist', () => {
    const result = extractExpansions(UNKNOWN_PAGE, 'PokémoncardInfobox');
    assert.equal(result.length, 0);
  });

  it('returns empty array for a different template name on the same wikitext', () => {
    const result = extractExpansions(CHARIZARD_BASE4, 'TCGTrainerCardInfobox');
    assert.equal(result.length, 0);
  });
});

// ─── extractTcgPokemonCard ────────────────────────────────────────────────────

describe('extractTcgPokemonCard', () => {
  it('sets _type to tcg_pokemon_card', () => {
    const result = extractTcgPokemonCard('Charizard (Base Set 4)', CHARIZARD_BASE4, []);
    assert.equal(result._type, 'tcg_pokemon_card');
  });

  it('preserves the title', () => {
    const result = extractTcgPokemonCard('Charizard (Base Set 4)', CHARIZARD_BASE4, []);
    assert.equal(result.title, 'Charizard (Base Set 4)');
  });

  it('extracts cardname as name', () => {
    const result = extractTcgPokemonCard('Charizard (Base Set 4)', CHARIZARD_BASE4, []);
    assert.equal(result.name, 'Charizard');
  });

  it('extracts jname', () => {
    const result = extractTcgPokemonCard('Charizard (Base Set 4)', CHARIZARD_BASE4, []);
    assert.equal(result.jname, 'リザードン');
  });

  it('extracts species', () => {
    const result = extractTcgPokemonCard('Charizard (Base Set 4)', CHARIZARD_BASE4, []);
    assert.equal(result.species, 'Charizard');
  });

  it('extracts evostage as stage', () => {
    const result = extractTcgPokemonCard('Charizard (Base Set 4)', CHARIZARD_BASE4, []);
    assert.equal(result.stage, 'Stage 2');
  });

  it('extracts type as card_type', () => {
    const result = extractTcgPokemonCard('Charizard (Base Set 4)', CHARIZARD_BASE4, []);
    assert.equal(result.card_type, 'Fire');
  });

  it('extracts hp as number', () => {
    const result = extractTcgPokemonCard('Charizard (Base Set 4)', CHARIZARD_BASE4, []);
    assert.equal(result.hp, 120);
  });

  it('extracts weakness', () => {
    const result = extractTcgPokemonCard('Charizard (Base Set 4)', CHARIZARD_BASE4, []);
    assert.equal(result.weakness, 'Water');
  });

  it('extracts resistance', () => {
    const result = extractTcgPokemonCard('Charizard (Base Set 4)', CHARIZARD_BASE4, []);
    assert.equal(result.resistance, 'Fighting');
  });

  it('extracts retreat_cost as number', () => {
    const result = extractTcgPokemonCard('Charizard (Base Set 4)', CHARIZARD_BASE4, []);
    assert.equal(result.retreat_cost, 3);
  });

  it('includes two expansions', () => {
    const result = extractTcgPokemonCard('Charizard (Base Set 4)', CHARIZARD_BASE4, []);
    assert.equal(result.expansions.length, 2);
  });

  it('passes categories through', () => {
    const cats = ['TCG cards', 'Charizard (TCG)'];
    const result = extractTcgPokemonCard('Charizard (Base Set 4)', CHARIZARD_BASE4, cats);
    assert.deepEqual(result.categories, cats);
  });

  it('returns null hp for wikitext missing hp field', () => {
    const wikitext = `{{PokémoncardInfobox\n| cardname = Pikachu\n| evostage = Basic\n}}`;
    const result = extractTcgPokemonCard('Pikachu', wikitext, []);
    assert.equal(result.hp, null);
  });

  it('returns null retreat_cost for wikitext missing retreatcost', () => {
    const wikitext = `{{PokémoncardInfobox\n| cardname = Pikachu\n}}`;
    const result = extractTcgPokemonCard('Pikachu', wikitext, []);
    assert.equal(result.retreat_cost, null);
  });

  it('returns empty expansions when none present', () => {
    const wikitext = `{{PokémoncardInfobox\n| cardname = Pikachu\n}}`;
    const result = extractTcgPokemonCard('Pikachu', wikitext, []);
    assert.equal(result.expansions.length, 0);
  });
});

// ─── extractTcgTrainerCard ────────────────────────────────────────────────────

describe('extractTcgTrainerCard', () => {
  it('sets _type to tcg_trainer_card', () => {
    const result = extractTcgTrainerCard('Professor Elm (Neo Genesis 96)', PROFESSOR_ELM, []);
    assert.equal(result._type, 'tcg_trainer_card');
  });

  it('preserves the title', () => {
    const result = extractTcgTrainerCard('Professor Elm (Neo Genesis 96)', PROFESSOR_ELM, []);
    assert.equal(result.title, 'Professor Elm (Neo Genesis 96)');
  });

  it('extracts cardname as name', () => {
    const result = extractTcgTrainerCard('Professor Elm (Neo Genesis 96)', PROFESSOR_ELM, []);
    assert.equal(result.name, 'Professor Elm');
  });

  it('extracts jname', () => {
    const result = extractTcgTrainerCard('Professor Elm (Neo Genesis 96)', PROFESSOR_ELM, []);
    assert.ok(result.jname !== null, 'expected non-null jname');
  });

  it('extracts class as card_class', () => {
    const result = extractTcgTrainerCard('Professor Elm (Neo Genesis 96)', PROFESSOR_ELM, []);
    assert.equal(result.card_class, 'Old Trainer');
  });

  it('includes two expansions', () => {
    const result = extractTcgTrainerCard('Professor Elm (Neo Genesis 96)', PROFESSOR_ELM, []);
    assert.equal(result.expansions.length, 2);
  });

  it('first expansion is Neo Genesis', () => {
    const result = extractTcgTrainerCard('Professor Elm (Neo Genesis 96)', PROFESSOR_ELM, []);
    assert.equal(result.expansions[0]?.expansion, 'Neo Genesis');
  });

  it('passes categories through', () => {
    const cats = ['TCG Trainer cards'];
    const result = extractTcgTrainerCard('Prof Elm', PROFESSOR_ELM, cats);
    assert.deepEqual(result.categories, cats);
  });

  it('returns null card_class when class field absent', () => {
    const wikitext = `{{TCGTrainerCardInfobox\n| cardname = Energy Search\n}}`;
    const result = extractTcgTrainerCard('Energy Search', wikitext, []);
    assert.equal(result.card_class, null);
  });

  it('returns empty expansions when none present', () => {
    const wikitext = `{{TCGTrainerCardInfobox\n| cardname = Energy Search\n| class = Item\n}}`;
    const result = extractTcgTrainerCard('Energy Search', wikitext, []);
    assert.equal(result.expansions.length, 0);
  });
});

// ─── extractTcgSet ────────────────────────────────────────────────────────────

describe('extractTcgSet', () => {
  it('sets _type to tcg_set', () => {
    const result = extractTcgSet('Brilliant Stars (TCG)', BRILLIANT_STARS, []);
    assert.equal(result._type, 'tcg_set');
  });

  it('preserves the title', () => {
    const result = extractTcgSet('Brilliant Stars (TCG)', BRILLIANT_STARS, []);
    assert.equal(result.title, 'Brilliant Stars (TCG)');
  });

  it('extracts setname as name', () => {
    const result = extractTcgSet('Brilliant Stars (TCG)', BRILLIANT_STARS, []);
    assert.equal(result.name, 'Sword & Shield—Brilliant Stars');
  });

  it('extracts jasetname as ja_name', () => {
    const result = extractTcgSet('Brilliant Stars (TCG)', BRILLIANT_STARS, []);
    assert.equal(result.ja_name, 'スターバース');
  });

  it('extracts transsetname as translated_name', () => {
    const result = extractTcgSet('Brilliant Stars (TCG)', BRILLIANT_STARS, []);
    assert.equal(result.translated_name, 'Star Birth');
  });

  it('extracts encards as en_card_count number', () => {
    const result = extractTcgSet('Brilliant Stars (TCG)', BRILLIANT_STARS, []);
    assert.equal(result.en_card_count, 216);
  });

  it('extracts ensetnum as en_set_number', () => {
    const result = extractTcgSet('Brilliant Stars (TCG)', BRILLIANT_STARS, []);
    assert.equal(result.en_set_number, 9);
  });

  it('extracts enrelease as en_release string', () => {
    const result = extractTcgSet('Brilliant Stars (TCG)', BRILLIANT_STARS, []);
    assert.ok(result.en_release !== null, 'expected non-null en_release');
    assert.match(result.en_release ?? '', /2022/);
  });

  it('extracts jacards as ja_card_count', () => {
    const result = extractTcgSet('Brilliant Stars (TCG)', BRILLIANT_STARS, []);
    assert.equal(result.ja_card_count, 100);
  });

  it('extracts jarelease as ja_release string', () => {
    const result = extractTcgSet('Brilliant Stars (TCG)', BRILLIANT_STARS, []);
    assert.ok(result.ja_release !== null, 'expected non-null ja_release');
    assert.match(result.ja_release ?? '', /2022/);
  });

  it('passes categories through', () => {
    const cats = ['TCG expansions'];
    const result = extractTcgSet('Brilliant Stars (TCG)', BRILLIANT_STARS, cats);
    assert.deepEqual(result.categories, cats);
  });

  it('returns null name when setname absent', () => {
    const wikitext = `{{TCGExpansionInfobox\n| encards = 50\n}}`;
    const result = extractTcgSet('Unknown Set', wikitext, []);
    assert.equal(result.name, null);
  });

  it('returns null en_card_count when encards absent', () => {
    const wikitext = `{{TCGExpansionInfobox\n| setname = Test Set\n}}`;
    const result = extractTcgSet('Test Set', wikitext, []);
    assert.equal(result.en_card_count, null);
  });

  it('returns null en_set_number when ensetnum absent', () => {
    const wikitext = `{{TCGExpansionInfobox\n| setname = Test Set\n}}`;
    const result = extractTcgSet('Test Set', wikitext, []);
    assert.equal(result.en_set_number, null);
  });
});
