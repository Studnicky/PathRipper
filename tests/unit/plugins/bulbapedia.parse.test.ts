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
  extractTcgDeck,
  extractTcgPromo,
  extractLocation,
  extractCharacter,
  extractTrainerClass,
  extractUnitePokemon,
  extractTcgEnergyCard,
  extractGame,
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

// ─── Fixtures: new types ──────────────────────────────────────────────────────

const PALLET_TOWN = `
{{Town infobox
| name       = Pallet Town
| jpname     = マサラタウン
| jptrans    = Masara Town
| image      = PalletTown.png
| slogan     = Shades of your journey await!
| region     = Kanto
| generation = I
}}
[[Category:Kanto locations]]
`;

const ROUTE_1 = `
{{Route infobox
| name       = Route 1
| jpname     = 1番道路
| region     = Kanto
| generation = I
}}
[[Category:Routes]]
`;

const VIRIDIAN_FOREST = `
{{Infobox location
| image   = ViridianForest.png
| type    = Forest
| mapdesc = A thick forest.
}}
[[Category:Kanto locations]]
`;

const MISTY = `
{{Character Infobox
| name  = Misty
| jname = カスミ
| color = Blue
| image = Misty.png
| size  = 200
}}
[[Category:Anime characters]]
`;

const GYM_LEADER = `
{{TrainerClassInfobox
| name   = Gym Leader
| jpname = ジムリーダー
| image  = GymLeaderSprite.png
}}
[[Category:Trainer classes]]
`;

const BRILLIANT_STARS_DECK = `
{{DeckInfobox
| name    = Leafeon V Strike
| release = March 25, 2022
| set     = Brilliant Stars
}}
[[Category:TCG decks]]
`;

const PROMO_CARD = `
{{TCGPromoInfobox
| name = Pikachu Promo
}}
[[Category:TCG promo cards]]
`;

// ─── extractLocation ──────────────────────────────────────────────────────────

describe('extractLocation', () => {
  it('sets _type to location for Town infobox', () => {
    const result = extractLocation('Pallet Town', PALLET_TOWN, []);
    assert.equal(result._type, 'location');
  });

  it('extracts name from Town infobox', () => {
    const result = extractLocation('Pallet Town', PALLET_TOWN, []);
    assert.equal(result.name, 'Pallet Town');
  });

  it('extracts ja_name from jpname field', () => {
    const result = extractLocation('Pallet Town', PALLET_TOWN, []);
    assert.equal(result.ja_name, 'マサラタウン');
  });

  it('extracts region', () => {
    const result = extractLocation('Pallet Town', PALLET_TOWN, []);
    assert.equal(result.region, 'Kanto');
  });

  it('extracts generation', () => {
    const result = extractLocation('Pallet Town', PALLET_TOWN, []);
    assert.equal(result.generation, 'I');
  });

  it('sets location_type to city for Town infobox', () => {
    const result = extractLocation('Pallet Town', PALLET_TOWN, []);
    assert.equal(result.location_type, 'city');
  });

  it('sets location_type to route for Route infobox', () => {
    const result = extractLocation('Route 1', ROUTE_1, []);
    assert.equal(result.location_type, 'route');
  });

  it('sets location_type to location for Infobox location', () => {
    const result = extractLocation('Viridian Forest', VIRIDIAN_FOREST, []);
    assert.equal(result.location_type, 'location');
  });

  it('passes categories through', () => {
    const cats = ['Kanto locations'];
    const result = extractLocation('Pallet Town', PALLET_TOWN, cats);
    assert.deepEqual(result.categories, cats);
  });

  it('preserves the title', () => {
    const result = extractLocation('Pallet Town', PALLET_TOWN, []);
    assert.equal(result.title, 'Pallet Town');
  });

  it('returns null region when field absent', () => {
    const wikitext = `{{Town infobox\n| name = Test Town\n}}`;
    const result = extractLocation('Test Town', wikitext, []);
    assert.equal(result.region, null);
  });

  it('returns null generation when field absent', () => {
    const wikitext = `{{Town infobox\n| name = Test Town\n}}`;
    const result = extractLocation('Test Town', wikitext, []);
    assert.equal(result.generation, null);
  });
});

// ─── extractCharacter ─────────────────────────────────────────────────────────

describe('extractCharacter', () => {
  it('sets _type to character', () => {
    const result = extractCharacter('Misty', MISTY, []);
    assert.equal(result._type, 'character');
  });

  it('preserves the title', () => {
    const result = extractCharacter('Misty', MISTY, []);
    assert.equal(result.title, 'Misty');
  });

  it('extracts name', () => {
    const result = extractCharacter('Misty', MISTY, []);
    assert.equal(result.name, 'Misty');
  });

  it('extracts jname', () => {
    const result = extractCharacter('Misty', MISTY, []);
    assert.equal(result.jname, 'カスミ');
  });

  it('passes categories through', () => {
    const cats = ['Anime characters'];
    const result = extractCharacter('Misty', MISTY, cats);
    assert.deepEqual(result.categories, cats);
  });

  it('returns null name when field absent', () => {
    const wikitext = `{{Character Infobox\n| color = Red\n}}`;
    const result = extractCharacter('Unknown', wikitext, []);
    assert.equal(result.name, null);
  });

  it('returns null jname when field absent', () => {
    const wikitext = `{{Character Infobox\n| name = Ash\n}}`;
    const result = extractCharacter('Ash', wikitext, []);
    assert.equal(result.jname, null);
  });
});

// ─── extractTrainerClass ──────────────────────────────────────────────────────

describe('extractTrainerClass', () => {
  it('sets _type to trainer_class', () => {
    const result = extractTrainerClass('Gym Leader', GYM_LEADER, []);
    assert.equal(result._type, 'trainer_class');
  });

  it('preserves the title', () => {
    const result = extractTrainerClass('Gym Leader', GYM_LEADER, []);
    assert.equal(result.title, 'Gym Leader');
  });

  it('extracts name', () => {
    const result = extractTrainerClass('Gym Leader', GYM_LEADER, []);
    assert.equal(result.name, 'Gym Leader');
  });

  it('extracts ja_name from jpname field', () => {
    const result = extractTrainerClass('Gym Leader', GYM_LEADER, []);
    assert.equal(result.ja_name, 'ジムリーダー');
  });

  it('passes categories through', () => {
    const cats = ['Trainer classes'];
    const result = extractTrainerClass('Gym Leader', GYM_LEADER, cats);
    assert.deepEqual(result.categories, cats);
  });

  it('returns null name when field absent', () => {
    const wikitext = `{{TrainerClassInfobox\n| jpname = テスト\n}}`;
    const result = extractTrainerClass('Test', wikitext, []);
    assert.equal(result.name, null);
  });

  it('returns null ja_name when jpname absent', () => {
    const wikitext = `{{TrainerClassInfobox\n| name = Test\n}}`;
    const result = extractTrainerClass('Test', wikitext, []);
    assert.equal(result.ja_name, null);
  });
});

// ─── extractTcgDeck ───────────────────────────────────────────────────────────

describe('extractTcgDeck', () => {
  it('sets _type to tcg_deck', () => {
    const result = extractTcgDeck('Leafeon V Strike', BRILLIANT_STARS_DECK, []);
    assert.equal(result._type, 'tcg_deck');
  });

  it('preserves the title', () => {
    const result = extractTcgDeck('Leafeon V Strike', BRILLIANT_STARS_DECK, []);
    assert.equal(result.title, 'Leafeon V Strike');
  });

  it('extracts name', () => {
    const result = extractTcgDeck('Leafeon V Strike', BRILLIANT_STARS_DECK, []);
    assert.equal(result.name, 'Leafeon V Strike');
  });

  it('passes categories through', () => {
    const cats = ['TCG decks'];
    const result = extractTcgDeck('Leafeon V Strike', BRILLIANT_STARS_DECK, cats);
    assert.deepEqual(result.categories, cats);
  });

  it('returns null name when field absent', () => {
    const wikitext = `{{DeckInfobox\n| release = 2022\n}}`;
    const result = extractTcgDeck('Unknown Deck', wikitext, []);
    assert.equal(result.name, null);
  });
});

// ─── extractTcgPromo ──────────────────────────────────────────────────────────

describe('extractTcgPromo', () => {
  it('sets _type to tcg_promo', () => {
    const result = extractTcgPromo('Pikachu Promo', PROMO_CARD, []);
    assert.equal(result._type, 'tcg_promo');
  });

  it('preserves the title', () => {
    const result = extractTcgPromo('Pikachu Promo', PROMO_CARD, []);
    assert.equal(result.title, 'Pikachu Promo');
  });

  it('extracts name', () => {
    const result = extractTcgPromo('Pikachu Promo', PROMO_CARD, []);
    assert.equal(result.name, 'Pikachu Promo');
  });

  it('passes categories through', () => {
    const cats = ['TCG promo cards'];
    const result = extractTcgPromo('Pikachu Promo', PROMO_CARD, cats);
    assert.deepEqual(result.categories, cats);
  });

  it('returns null name when field absent', () => {
    const wikitext = `{{TCGPromoInfobox\n}}`;
    const result = extractTcgPromo('Unknown Promo', wikitext, []);
    assert.equal(result.name, null);
  });
});

// ─── Fixtures: UNITE, Energy, Game ───────────────────────────────────────────

const ABSOL_UNITE = `
{{UniteInfobox
| pokemon    = Absol
| jname      = アブソル
| jtrans     = Absol
| image      = AbsolUnite.png
| size       = 250
| role       = Speedster
| range      = Melee
| damage     = Physical
| difficulty = Intermediate
| evolve     = No
| ndex1      = 359
| level1     = 1
| gem        = 8000
}}
[[Category:Pokémon UNITE]]
[[Category:Speedster Pokémon]]
`;

const FIRE_ENERGY = `
{{TCGEnergyCardInfobox
| cardname = Fire Energy
| energy   = Fire
| image    = FireEnergy.png
}}
{{TCGEnergyCardInfobox/Expansion
| expansion = {{TCG|Base Set}}
| cardno    = 98/102
}}
[[Category:Energy cards]]
[[Category:Fire Energy cards]]
`;

const POKEMON_SLEEP = `
{{Infobox game
| name            = Pokémon Sleep
| jname           = ポケモンスリープ
| boxart          = PokémonSleepCoverArt.png
| platform        = iOS, Android
| publisher       = The Pokémon Company
| developer       = SELECT BUTTON
| release_date_ja = July 17, 2023
| release_date_us = July 17, 2023
| gen_series      = IX
}}
[[Category:Games]]
[[Category:Pokémon Sleep]]
`;

// ─── extractUnitePokemon ──────────────────────────────────────────────────────

describe('extractUnitePokemon', () => {
  it('sets _type to unite_pokemon', () => {
    const result = extractUnitePokemon('Absol (UNITE)', ABSOL_UNITE, []);
    assert.equal(result._type, 'unite_pokemon');
  });

  it('preserves the title', () => {
    const result = extractUnitePokemon('Absol (UNITE)', ABSOL_UNITE, []);
    assert.equal(result.title, 'Absol (UNITE)');
  });

  it('extracts pokemon species name', () => {
    const result = extractUnitePokemon('Absol (UNITE)', ABSOL_UNITE, []);
    assert.equal(result.pokemon, 'Absol');
  });

  it('extracts jname', () => {
    const result = extractUnitePokemon('Absol (UNITE)', ABSOL_UNITE, []);
    assert.equal(result.jname, 'アブソル');
  });

  it('extracts role', () => {
    const result = extractUnitePokemon('Absol (UNITE)', ABSOL_UNITE, []);
    assert.equal(result.role, 'Speedster');
  });

  it('extracts range', () => {
    const result = extractUnitePokemon('Absol (UNITE)', ABSOL_UNITE, []);
    assert.equal(result.range, 'Melee');
  });

  it('extracts damage', () => {
    const result = extractUnitePokemon('Absol (UNITE)', ABSOL_UNITE, []);
    assert.equal(result.damage, 'Physical');
  });

  it('extracts difficulty', () => {
    const result = extractUnitePokemon('Absol (UNITE)', ABSOL_UNITE, []);
    assert.equal(result.difficulty, 'Intermediate');
  });

  it('passes categories through', () => {
    const cats = ['Pokémon UNITE', 'Speedster Pokémon'];
    const result = extractUnitePokemon('Absol (UNITE)', ABSOL_UNITE, cats);
    assert.deepEqual(result.categories, cats);
  });

  it('returns null pokemon when field absent', () => {
    const wikitext = `{{UniteInfobox\n| role = Attacker\n}}`;
    const result = extractUnitePokemon('Unknown (UNITE)', wikitext, []);
    assert.equal(result.pokemon, null);
  });

  it('returns null role when field absent', () => {
    const wikitext = `{{UniteInfobox\n| pokemon = Pikachu\n}}`;
    const result = extractUnitePokemon('Pikachu (UNITE)', wikitext, []);
    assert.equal(result.role, null);
  });

  it('returns null for all optional fields on empty infobox', () => {
    const wikitext = `{{UniteInfobox\n}}`;
    const result = extractUnitePokemon('Test (UNITE)', wikitext, []);
    assert.equal(result.pokemon, null);
    assert.equal(result.jname, null);
    assert.equal(result.role, null);
    assert.equal(result.range, null);
    assert.equal(result.damage, null);
    assert.equal(result.difficulty, null);
  });
});

// ─── extractTcgEnergyCard ─────────────────────────────────────────────────────

describe('extractTcgEnergyCard', () => {
  it('sets _type to tcg_energy_card', () => {
    const result = extractTcgEnergyCard('Fire Energy (Base Set 98)', FIRE_ENERGY, []);
    assert.equal(result._type, 'tcg_energy_card');
  });

  it('preserves the title', () => {
    const result = extractTcgEnergyCard('Fire Energy (Base Set 98)', FIRE_ENERGY, []);
    assert.equal(result.title, 'Fire Energy (Base Set 98)');
  });

  it('extracts cardname as name', () => {
    const result = extractTcgEnergyCard('Fire Energy (Base Set 98)', FIRE_ENERGY, []);
    assert.equal(result.name, 'Fire Energy');
  });

  it('extracts energy field as energy_type', () => {
    const result = extractTcgEnergyCard('Fire Energy (Base Set 98)', FIRE_ENERGY, []);
    assert.equal(result.energy_type, 'Fire');
  });

  it('passes categories through', () => {
    const cats = ['Energy cards', 'Fire Energy cards'];
    const result = extractTcgEnergyCard('Fire Energy (Base Set 98)', FIRE_ENERGY, cats);
    assert.deepEqual(result.categories, cats);
  });

  it('returns null name when cardname absent', () => {
    const wikitext = `{{TCGEnergyCardInfobox\n| energy = Water\n}}`;
    const result = extractTcgEnergyCard('Water Energy', wikitext, []);
    assert.equal(result.name, null);
  });

  it('returns null energy_type when energy field absent', () => {
    const wikitext = `{{TCGEnergyCardInfobox\n| cardname = Basic Energy\n}}`;
    const result = extractTcgEnergyCard('Basic Energy', wikitext, []);
    assert.equal(result.energy_type, null);
  });

  it('falls back to type field when energy field absent', () => {
    const wikitext = `{{TCGEnergyCardInfobox\n| cardname = Lightning Energy\n| type = Lightning\n}}`;
    const result = extractTcgEnergyCard('Lightning Energy', wikitext, []);
    assert.equal(result.energy_type, 'Lightning');
  });
});

// ─── extractGame ─────────────────────────────────────────────────────────────

describe('extractGame', () => {
  it('sets _type to game', () => {
    const result = extractGame('Pokémon Sleep', POKEMON_SLEEP, []);
    assert.equal(result._type, 'game');
  });

  it('preserves the title', () => {
    const result = extractGame('Pokémon Sleep', POKEMON_SLEEP, []);
    assert.equal(result.title, 'Pokémon Sleep');
  });

  it('extracts name', () => {
    const result = extractGame('Pokémon Sleep', POKEMON_SLEEP, []);
    assert.equal(result.name, 'Pokémon Sleep');
  });

  it('extracts jname', () => {
    const result = extractGame('Pokémon Sleep', POKEMON_SLEEP, []);
    assert.equal(result.jname, 'ポケモンスリープ');
  });

  it('extracts platform', () => {
    const result = extractGame('Pokémon Sleep', POKEMON_SLEEP, []);
    assert.equal(result.platform, 'iOS, Android');
  });

  it('extracts developer', () => {
    const result = extractGame('Pokémon Sleep', POKEMON_SLEEP, []);
    assert.equal(result.developer, 'SELECT BUTTON');
  });

  it('extracts publisher', () => {
    const result = extractGame('Pokémon Sleep', POKEMON_SLEEP, []);
    assert.equal(result.publisher, 'The Pokémon Company');
  });

  it('extracts release_ja', () => {
    const result = extractGame('Pokémon Sleep', POKEMON_SLEEP, []);
    assert.ok(result.release_ja !== null, 'expected non-null release_ja');
    assert.match(result.release_ja ?? '', /2023/);
  });

  it('extracts release_us', () => {
    const result = extractGame('Pokémon Sleep', POKEMON_SLEEP, []);
    assert.ok(result.release_us !== null, 'expected non-null release_us');
    assert.match(result.release_us ?? '', /2023/);
  });

  it('passes categories through', () => {
    const cats = ['Games', 'Pokémon Sleep'];
    const result = extractGame('Pokémon Sleep', POKEMON_SLEEP, cats);
    assert.deepEqual(result.categories, cats);
  });

  it('returns null name when field absent', () => {
    const wikitext = `{{Infobox game\n| platform = Nintendo Switch\n}}`;
    const result = extractGame('Unknown Game', wikitext, []);
    assert.equal(result.name, null);
  });

  it('returns null platform when field absent', () => {
    const wikitext = `{{Infobox game\n| name = Test Game\n}}`;
    const result = extractGame('Test Game', wikitext, []);
    assert.equal(result.platform, null);
  });

  it('returns null release_ja when release_date_ja absent', () => {
    const wikitext = `{{Infobox game\n| name = Test Game\n}}`;
    const result = extractGame('Test Game', wikitext, []);
    assert.equal(result.release_ja, null);
  });
});
