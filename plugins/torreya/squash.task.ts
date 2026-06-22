/**
 * @fileoverview Squash plugin for Torreya / Bulbapedia records.
 *
 * @remarks
 * Receives classified records from the Squashage pipeline and emits RDF/JS
 * quads into `state.context.dataset`. Each record type is mapped to the
 * canonical pokemontology IRI space and placed in the appropriate named graph.
 *
 * ## Record types handled
 *
 * | Classification | IRI base                             | Named graph                                      |
 * |----------------|--------------------------------------|--------------------------------------------------|
 * | Pokemon        | `https://pokemontology.dev/species/` | `graph/universal/species`                        |
 * | Move           | `https://pokemontology.dev/move/`    | `graph/universal/moves`                          |
 * | Item           | `https://pokemontology.dev/item/`    | `graph/universal/items`                          |
 * | Character      | `https://pokemontology.dev/trainer/` | `graph/universal/characters`                     |
 * | TrainerClass   | `https://pokemontology.dev/trainer-class/` | `graph/universal/trainer-classes`          |
 * | Location       | `https://pokemontology.dev/location/`| `graph/universal/bulbapedia-locations`           |
 * | SyncPair       | (skipped — leaner Masters EX source available via pkmex ontology) |              |
 * | UnitePokemon   | `https://pokemontology.dev/species/` | `graph/unite/pokemon`                            |
 * | Learnset       | (skipped — authoritative data from Veekun VG-learnset pipeline) |              |
 *
 * ## Integration note (wire into Torreya generate.ts)
 *
 * When the plugin is working correctly, the Torreya generate pipeline can call:
 *
 * ```ts
 * import { registerTorreyaPlugin } from '../../squashage/plugins/torreya/squash.task.js';
 * import { SquashageConfig }       from '../../squashage/src/config/SquashageConfig.js';
 * import { SquashageOrchestrator } from '../../squashage/src/orchestrators/SquashageOrchestrator.js';
 *
 * registerTorreyaPlugin();
 * const config = SquashageConfig.loadFromFile('./squashage.config.torreya-squash.json');
 * const result = await SquashageOrchestrator.run(config, 'torreya', {
 *   outDir:     './graphs/torreya',
 *   configPath: './squashage.config.torreya-squash.json',
 * });
 * ```
 *
 * The resulting `bulbapedia.trig` is written to
 * `packages/pokemontology/ontology/universal/bulbapedia.trig` and loaded by
 * Fuseki as part of the cold-tier graph store.
 *
 * @module plugins/torreya/squash.task
 */

import { TaskRegistry } from '../../src/registry/TaskRegistry.js';
import type { NextFnInterface } from '../../src/types/Pipeline.js';
import type { PipelineStateInterface } from '../../src/types/PipelineState.js';
import type { DataFactory, NamedNode, Literal } from '@rdfjs/types';

// ─── Namespace IRIs ────────────────────────────────────────────────────────────

const PKM            = 'https://pokemontology.dev/ontology#';
const BASE_SPECIES   = 'https://pokemontology.dev/species/';
const BASE_MOVE      = 'https://pokemontology.dev/move/';
const BASE_ABILITY   = 'https://pokemontology.dev/ability/';
const BASE_TYPE      = 'https://pokemontology.dev/type/';
const BASE_EGG_GROUP = 'https://pokemontology.dev/egg-group/';
const BASE_TRAINER   = 'https://pokemontology.dev/trainer/';
const BASE_TRAINER_CLASS = 'https://pokemontology.dev/trainer-class/';
const BASE_LOCATION  = 'https://pokemontology.dev/location/';
const BASE_REGION    = 'https://pokemontology.dev/region/';
const BASE_ITEM      = 'https://pokemontology.dev/item/';
const BASE_GEN       = 'https://pokemontology.dev/generation/';
const BASE_ORG       = 'https://pokemontology.dev/organization/';

// ─── Named graph IRIs ──────────────────────────────────────────────────────────

const GRAPH_SPECIES       = 'https://pokemontology.dev/graph/universal/species';
const GRAPH_MOVES         = 'https://pokemontology.dev/graph/universal/moves';
const GRAPH_ITEMS         = 'https://pokemontology.dev/graph/universal/items';
const GRAPH_CHARACTERS    = 'https://pokemontology.dev/graph/universal/characters';
const GRAPH_TRAINER_CLASSES = 'https://pokemontology.dev/graph/universal/trainer-classes';
const GRAPH_LOCATIONS     = 'https://pokemontology.dev/graph/universal/bulbapedia-locations';
const GRAPH_UNITE         = 'https://pokemontology.dev/graph/unite/pokemon';

// ─── Standard vocabulary IRIs ─────────────────────────────────────────────────

const RDF_TYPE   = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label';
const XSD_INT    = 'http://www.w3.org/2001/XMLSchema#integer';
const XSD_STR    = 'http://www.w3.org/2001/XMLSchema#string';
const XSD_DEC    = 'http://www.w3.org/2001/XMLSchema#decimal';

// ─── Move damage categories ────────────────────────────────────────────────────

const MOVE_CLASS_MAP: Readonly<Record<string, string>> = {
  'Physical': `${PKM}PhysicalMove`,
  'Special':  `${PKM}SpecialMove`,
  'Status':   `${PKM}StatusMove`,
};

// ─── Character role inference (from Bulbapedia categories) ────────────────────

const ROLE_MAP: Readonly<Record<string, string>> = {
  'Gym Leaders':             `${PKM}GymLeader`,
  'Champions':               `${PKM}Champion`,
  'Professors':              `${PKM}Professor`,
  'Elite Four Trainers':     `${PKM}EliteFourMember`,
  'Elite Four':              `${PKM}EliteFourMember`,
  'Rival characters':        `${PKM}Rival`,
  'Trial Captains':          `${PKM}TrialCaptain`,
  'Island Kahunas':          `${PKM}IslandKahuna`,
  'Villainous team leaders': `${PKM}VillainousAdmin`,
};

const ORG_MAP: Readonly<Record<string, string>> = {
  'Members of Team Rocket':         'team-rocket',
  'Members of Team Rainbow Rocket': 'team-rocket',
  'Members of Team Aqua':           'team-aqua',
  'Members of Team Magma':          'team-magma',
  'Members of Team Galactic':       'team-galactic',
  'Members of Team Plasma':         'team-plasma',
  'Members of Team Flare':          'team-flare',
  'Members of Team Skull':          'team-skull',
  'Members of Team Yell':           'team-yell',
  'Members of Team Star':           'team-star',
  'Members of Cipher':              'cipher',
  'Members of Team Snagem':         'team-snagem',
};

const REGION_MAP: Readonly<Record<string, string>> = {
  'Red and Blue characters':                        'kanto',
  'Yellow characters':                              'kanto',
  'FireRed and LeafGreen characters':               'kanto',
  'Gold, Silver and Crystal characters':            'johto',
  'HeartGold and SoulSilver characters':            'johto',
  'Ruby, Sapphire and Emerald characters':          'hoenn',
  'Omega Ruby and Alpha Sapphire characters':       'hoenn',
  'Diamond and Pearl characters':                   'sinnoh',
  'Platinum characters':                            'sinnoh',
  'Brilliant Diamond and Shining Pearl characters': 'sinnoh',
  'Black and White characters':                     'unova',
  'Black 2 and White 2 characters':                 'unova',
  'X and Y characters':                             'kalos',
  'Sun and Moon characters':                        'alola',
  'Ultra Sun and Ultra Moon characters':            'alola',
  'Sword and Shield characters':                    'galar',
  'Scarlet and Violet characters':                  'paldea',
  'Legends: Arceus characters':                     'hisui',
};

// ─── Location category → class inference ──────────────────────────────────────

const LOCATION_CLASS_MAP: Readonly<Record<string, string>> = {
  'Gyms':              `${PKM}Gym`,
  'Gym':               `${PKM}Gym`,
  'Routes':            `${PKM}Route`,
  'Cities':            `${PKM}City`,
  'Towns':             `${PKM}Town`,
  'Caves':             `${PKM}Dungeon`,
  'Forests':           `${PKM}Dungeon`,
  'Safari Zones':      `${PKM}SafariZoneLocation`,
  'Battle facilities': `${PKM}BattleFacility`,
};

const REGION_IRI_MAP: Readonly<Record<string, string>> = {
  'Kanto':   `${BASE_REGION}kanto`,
  'Johto':   `${BASE_REGION}johto`,
  'Hoenn':   `${BASE_REGION}hoenn`,
  'Sinnoh':  `${BASE_REGION}sinnoh`,
  'Unova':   `${BASE_REGION}unova`,
  'Kalos':   `${BASE_REGION}kalos`,
  'Alola':   `${BASE_REGION}alola`,
  'Galar':   `${BASE_REGION}galar`,
  'Paldea':  `${BASE_REGION}paldea`,
  'Hisui':   `${BASE_REGION}hisui`,
  'Orre':    `${BASE_REGION}orre`,
  'Fiore':   `${BASE_REGION}fiore`,
  'Almia':   `${BASE_REGION}almia`,
  'Oblivia': `${BASE_REGION}oblivia`,
  'Ransei':  `${BASE_REGION}ransei`,
  'Ferrum':  `${BASE_REGION}ferrum`,
};

// ─── Generation mapping ────────────────────────────────────────────────────────

/** Roman numerals → lowercase IRI local name. */
const ROMAN_GEN_MAP: Readonly<Record<string, string>> = {
  'I': 'i', 'II': 'ii', 'III': 'iii', 'IV': 'iv',
  'V': 'v', 'VI': 'vi', 'VII': 'vii', 'VIII': 'viii', 'IX': 'ix',
};

/** Numeric strings → lowercase roman IRI local name. */
const NUMERIC_GEN_MAP: Readonly<Record<string, string>> = {
  '1': 'i', '2': 'ii', '3': 'iii', '4': 'iv',
  '5': 'v', '6': 'vi', '7': 'vii', '8': 'viii', '9': 'ix',
};

// ─── Slug helpers ──────────────────────────────────────────────────────────────

/**
 * Converts a display name to a URL-safe lowercase slug.
 * Matches the slug convention used across pokemontology IRIs.
 *
 * @param name - Display name (e.g. "Pikachu", "Human-Like").
 * @returns Lowercase slug (e.g. "pikachu", "human-like").
 */
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Resolves a generation string (numeric or roman numeral) to a generation IRI.
 *
 * @param gen - Generation value from the record (e.g. "9", "IX", "I").
 * @returns Named-node IRI string or null when the value is not recognized.
 */
function generationIri(gen: string): string | null {
  const roman   = ROMAN_GEN_MAP[gen.toUpperCase()];
  const numeric = NUMERIC_GEN_MAP[gen];
  const local   = roman ?? numeric;
  return local !== undefined ? `${BASE_GEN}${local}` : null;
}

// ─── Literal helpers ───────────────────────────────────────────────────────────

/** Create an English language-tagged literal. */
const enLabel = (value: string, factory: DataFactory): Literal =>
  factory.literal(value, 'en');

/** Create an xsd:integer literal from a number. */
const intLiteral = (value: number, factory: DataFactory): Literal =>
  factory.literal(String(value), factory.namedNode(XSD_INT));

/** Create an xsd:string literal. */
const strLiteral = (value: string, factory: DataFactory): Literal =>
  factory.literal(value, factory.namedNode(XSD_STR));

/** Create an xsd:decimal literal from a number. */
const decLiteral = (value: number, factory: DataFactory): Literal =>
  factory.literal(String(value), factory.namedNode(XSD_DEC));

// ─── Per-class emitters ────────────────────────────────────────────────────────

/**
 * Emits quads for a classified `pokemon` record.
 *
 * Emitted predicates (in graph `graph/universal/species`):
 * - `rdf:type pkm:Species`
 * - `pkm:name "Name"`
 * - `rdfs:label "Name"@en`
 * - `pkm:nationalDexNumber N`
 * - `pkm:hasType <type/slug>` (per type)
 * - `pkm:hasAbility <ability/slug>` (per non-hidden ability)
 * - `pkm:hasEggGroup <egg-group/slug>` (per egg group)
 * - `pkm:introducedIn <generation/X>` (when generation is present)
 */
function emitPokemonQuads(
  input:   Readonly<Record<string, unknown>>,
  factory: DataFactory,
  dataset: { add: (quad: ReturnType<DataFactory['quad']>) => void },
): void {
  const name = typeof input['name'] === 'string' && input['name'] !== '' ? input['name'] : null;
  if (name === null) {return;}

  const slug       = toSlug(name);
  const subject    = factory.namedNode(`${BASE_SPECIES}${slug}`);
  const graphNode  = factory.namedNode(GRAPH_SPECIES);
  const rdfType    = factory.namedNode(RDF_TYPE);
  const rdfsLabel  = factory.namedNode(RDFS_LABEL);

  dataset.add(factory.quad(subject, rdfType, factory.namedNode(`${PKM}Species`), graphNode));
  dataset.add(factory.quad(subject, factory.namedNode(`${PKM}name`), strLiteral(name, factory), graphNode));
  dataset.add(factory.quad(subject, rdfsLabel, enLabel(name, factory), graphNode));

  if (typeof input['ndex'] === 'number') {
    dataset.add(factory.quad(subject, factory.namedNode(`${PKM}nationalDexNumber`), intLiteral(input['ndex'], factory), graphNode));
  }

  const types = input['types'];
  if (Array.isArray(types)) {
    for (const t of types) {
      if (typeof t === 'string' && t !== '') {
        dataset.add(factory.quad(subject, factory.namedNode(`${PKM}hasType`), factory.namedNode(`${BASE_TYPE}${toSlug(t)}`), graphNode));
      }
    }
  }

  const abilities = input['abilities'];
  if (Array.isArray(abilities)) {
    for (const a of abilities) {
      if (typeof a === 'string' && a !== '') {
        dataset.add(factory.quad(subject, factory.namedNode(`${PKM}hasAbility`), factory.namedNode(`${BASE_ABILITY}${toSlug(a)}`), graphNode));
      }
    }
  }

  const eggGroups = input['egg_groups'];
  if (Array.isArray(eggGroups)) {
    for (const eg of eggGroups) {
      if (typeof eg === 'string' && eg !== '') {
        dataset.add(factory.quad(subject, factory.namedNode(`${PKM}hasEggGroup`), factory.namedNode(`${BASE_EGG_GROUP}${toSlug(eg)}`), graphNode));
      }
    }
  }

  if (typeof input['generation'] === 'string' && input['generation'] !== '') {
    const genIri = generationIri(input['generation']);
    if (genIri !== null) {
      dataset.add(factory.quad(subject, factory.namedNode(`${PKM}introducedIn`), factory.namedNode(genIri), graphNode));
    }
  }

  if (typeof input['height_m'] === 'number') {
    dataset.add(factory.quad(subject, factory.namedNode(`${PKM}heightM`), decLiteral(input['height_m'], factory), graphNode));
  }

  if (typeof input['weight_kg'] === 'number') {
    dataset.add(factory.quad(subject, factory.namedNode(`${PKM}weightKg`), decLiteral(input['weight_kg'], factory), graphNode));
  }
}

/**
 * Emits quads for a classified `move` record.
 *
 * Emitted predicates (in graph `graph/universal/moves`):
 * - `rdf:type pkm:PhysicalMove | pkm:SpecialMove | pkm:StatusMove`
 * - `pkm:name "Name"`
 * - `rdfs:label "Name"@en`
 * - `pkm:moveType <type/slug>`
 * - `pkm:basePower N`
 * - `pkm:accuracy N`
 * - `pkm:pp N`
 * - `pkm:introducedIn <generation/X>`
 */
function emitMoveQuads(
  input:   Readonly<Record<string, unknown>>,
  factory: DataFactory,
  dataset: { add: (quad: ReturnType<DataFactory['quad']>) => void },
): void {
  const name = typeof input['name'] === 'string' && input['name'] !== '' ? input['name'] : null;
  if (name === null) {return;}

  const slug      = toSlug(name);
  const subject   = factory.namedNode(`${BASE_MOVE}${slug}`);
  const graphNode = factory.namedNode(GRAPH_MOVES);
  const rdfType   = factory.namedNode(RDF_TYPE);
  const rdfsLabel = factory.namedNode(RDFS_LABEL);

  const rawCategory = typeof input['damage_category'] === 'string' ? input['damage_category'] : '';
  const moveClass   = MOVE_CLASS_MAP[rawCategory] ?? `${PKM}Move`;

  dataset.add(factory.quad(subject, rdfType, factory.namedNode(moveClass), graphNode));
  dataset.add(factory.quad(subject, factory.namedNode(`${PKM}name`), strLiteral(name, factory), graphNode));
  dataset.add(factory.quad(subject, rdfsLabel, enLabel(name, factory), graphNode));

  if (typeof input['type'] === 'string' && input['type'] !== '') {
    dataset.add(factory.quad(subject, factory.namedNode(`${PKM}moveType`), factory.namedNode(`${BASE_TYPE}${toSlug(input['type'])}`), graphNode));
  }

  if (typeof input['power'] === 'number') {
    dataset.add(factory.quad(subject, factory.namedNode(`${PKM}basePower`), intLiteral(input['power'], factory), graphNode));
  }

  if (typeof input['accuracy'] === 'number') {
    dataset.add(factory.quad(subject, factory.namedNode(`${PKM}accuracy`), intLiteral(input['accuracy'], factory), graphNode));
  }

  if (typeof input['base_pp'] === 'number') {
    dataset.add(factory.quad(subject, factory.namedNode(`${PKM}pp`), intLiteral(input['base_pp'], factory), graphNode));
  }

  if (typeof input['generation'] === 'string' && input['generation'] !== '') {
    const genIri = generationIri(input['generation']);
    if (genIri !== null) {
      dataset.add(factory.quad(subject, factory.namedNode(`${PKM}introducedIn`), factory.namedNode(genIri), graphNode));
    }
  }
}

/**
 * Emits quads for a classified `item` record.
 *
 * Emitted predicates (in graph `graph/universal/items`):
 * - `rdf:type pkm:Item`
 * - `pkm:name "Name"`
 * - `rdfs:label "Name"@en`
 * - `pkm:introducedIn <generation/X>` (when present)
 */
function emitItemQuads(
  input:   Readonly<Record<string, unknown>>,
  factory: DataFactory,
  dataset: { add: (quad: ReturnType<DataFactory['quad']>) => void },
): void {
  const name = typeof input['name'] === 'string' && input['name'] !== '' ? input['name'] : null;
  if (name === null) {return;}

  const slug      = toSlug(name);
  const subject   = factory.namedNode(`${BASE_ITEM}${slug}`);
  const graphNode = factory.namedNode(GRAPH_ITEMS);
  const rdfType   = factory.namedNode(RDF_TYPE);
  const rdfsLabel = factory.namedNode(RDFS_LABEL);

  dataset.add(factory.quad(subject, rdfType, factory.namedNode(`${PKM}Item`), graphNode));
  dataset.add(factory.quad(subject, factory.namedNode(`${PKM}name`), strLiteral(name, factory), graphNode));
  dataset.add(factory.quad(subject, rdfsLabel, enLabel(name, factory), graphNode));

  if (typeof input['generation'] === 'string' && input['generation'] !== '') {
    const genIri = generationIri(input['generation']);
    if (genIri !== null) {
      dataset.add(factory.quad(subject, factory.namedNode(`${PKM}introducedIn`), factory.namedNode(genIri), graphNode));
    }
  }
}

/**
 * Emits quads for a classified `character` record.
 *
 * Subject IRI derived from the record's filename slug (via the `title` field).
 * Emitted predicates (in graph `graph/universal/characters`):
 * - `rdf:type pkm:Trainer` (always)
 * - `rdf:type pkm:GymLeader | pkm:Champion | ...` (inferred from categories)
 * - `pkm:name "Name"`
 * - `rdfs:label "Name"@en`
 * - `pkm:homeRegion <region/slug>` (inferred from categories)
 * - `pkm:memberOfOrganization <organization/slug>` (inferred from categories)
 */
function emitCharacterQuads(
  input:   Readonly<Record<string, unknown>>,
  factory: DataFactory,
  dataset: { add: (quad: ReturnType<DataFactory['quad']>) => void },
): void {
  const name = typeof input['name'] === 'string' && input['name'] !== '' ? input['name'] : null;
  if (name === null) {return;}

  // Use title to derive the slug (matches Bulbapedia filename convention).
  const titleRaw = typeof input['title'] === 'string' ? input['title'] : name;
  const slug     = toSlug(titleRaw);
  const subject  = factory.namedNode(`${BASE_TRAINER}${slug}`);
  const graphNode = factory.namedNode(GRAPH_CHARACTERS);
  const rdfType   = factory.namedNode(RDF_TYPE);
  const rdfsLabel = factory.namedNode(RDFS_LABEL);

  const categories = Array.isArray(input['categories'])
    ? (input['categories'] as unknown[]).filter((c): c is string => typeof c === 'string')
    : [];

  // rdf:type — Trainer always, role types from categories
  dataset.add(factory.quad(subject, rdfType, factory.namedNode(`${PKM}Trainer`), graphNode));
  const roleTypes = new Set<string>();
  for (const cat of categories) {
    const roleIri = ROLE_MAP[cat];
    if (roleIri !== undefined) {roleTypes.add(roleIri);}
  }
  for (const roleIri of roleTypes) {
    dataset.add(factory.quad(subject, rdfType, factory.namedNode(roleIri), graphNode));
  }

  dataset.add(factory.quad(subject, factory.namedNode(`${PKM}name`), strLiteral(name, factory), graphNode));
  dataset.add(factory.quad(subject, rdfsLabel, enLabel(name, factory), graphNode));

  // homeRegion — inferred from categories
  const regions = new Set<string>();
  for (const cat of categories) {
    const regionSlug = REGION_MAP[cat];
    if (regionSlug !== undefined) {regions.add(regionSlug);}
  }
  for (const regionSlug of regions) {
    dataset.add(factory.quad(subject, factory.namedNode(`${PKM}homeRegion`), factory.namedNode(`${BASE_REGION}${regionSlug}`), graphNode));
  }

  // memberOfOrganization — inferred from categories
  const orgs = new Set<string>();
  for (const cat of categories) {
    const orgSlug = ORG_MAP[cat];
    if (orgSlug !== undefined) {orgs.add(orgSlug);}
  }
  for (const orgSlug of orgs) {
    dataset.add(factory.quad(subject, factory.namedNode(`${PKM}memberOfOrganization`), factory.namedNode(`${BASE_ORG}${orgSlug}`), graphNode));
  }
}

/**
 * Emits quads for a classified `trainer_class` record.
 *
 * Emitted predicates (in graph `graph/universal/trainer-classes`):
 * - `rdf:type pkm:TrainerClass`
 * - `pkm:name "Name"`
 * - `rdfs:label "Name"@en`
 */
function emitTrainerClassQuads(
  input:   Readonly<Record<string, unknown>>,
  factory: DataFactory,
  dataset: { add: (quad: ReturnType<DataFactory['quad']>) => void },
): void {
  const name = typeof input['name'] === 'string' && input['name'] !== '' ? input['name'] : null;
  if (name === null) {return;}

  const titleRaw = typeof input['title'] === 'string' ? input['title'] : name;
  const slug     = toSlug(titleRaw);
  const subject  = factory.namedNode(`${BASE_TRAINER_CLASS}${slug}`);
  const graphNode = factory.namedNode(GRAPH_TRAINER_CLASSES);
  const rdfType   = factory.namedNode(RDF_TYPE);
  const rdfsLabel = factory.namedNode(RDFS_LABEL);

  dataset.add(factory.quad(subject, rdfType, factory.namedNode(`${PKM}TrainerClass`), graphNode));
  dataset.add(factory.quad(subject, factory.namedNode(`${PKM}name`), strLiteral(name, factory), graphNode));
  dataset.add(factory.quad(subject, rdfsLabel, enLabel(name, factory), graphNode));
}

/**
 * Emits quads for a classified `location` record.
 *
 * Emitted predicates (in graph `graph/universal/bulbapedia-locations`):
 * - `rdf:type pkm:Location` (or subclass inferred from categories)
 * - `pkm:name "Name"`
 * - `rdfs:label "Name"@en`
 * - `pkm:locatedInRegion <region/slug>` (when region is present)
 */
function emitLocationQuads(
  input:   Readonly<Record<string, unknown>>,
  factory: DataFactory,
  dataset: { add: (quad: ReturnType<DataFactory['quad']>) => void },
): void {
  const rawName  = typeof input['name']  === 'string' ? input['name']  : '';
  const rawTitle = typeof input['title'] === 'string' ? input['title'] : '';
  const name     = rawName !== '' ? rawName : rawTitle;
  if (name === '') {return;}

  const titleForSlug = rawTitle !== '' ? rawTitle : name;
  const slug         = toSlug(titleForSlug);
  const subject      = factory.namedNode(`${BASE_LOCATION}${slug}`);
  const graphNode    = factory.namedNode(GRAPH_LOCATIONS);
  const rdfType      = factory.namedNode(RDF_TYPE);
  const rdfsLabel    = factory.namedNode(RDFS_LABEL);

  const categories = Array.isArray(input['categories'])
    ? (input['categories'] as unknown[]).filter((c): c is string => typeof c === 'string')
    : [];

  let locationClass = `${PKM}Location`;
  for (const cat of categories) {
    const mapped = LOCATION_CLASS_MAP[cat];
    if (mapped !== undefined) {locationClass = mapped; break;}
  }

  dataset.add(factory.quad(subject, rdfType, factory.namedNode(locationClass), graphNode));
  dataset.add(factory.quad(subject, factory.namedNode(`${PKM}name`), strLiteral(name, factory), graphNode));
  dataset.add(factory.quad(subject, rdfsLabel, enLabel(name, factory), graphNode));

  const region = typeof input['region'] === 'string' && input['region'] !== '' ? input['region'] : null;
  if (region !== null) {
    const regionIri = REGION_IRI_MAP[region];
    if (regionIri !== undefined) {
      dataset.add(factory.quad(subject, factory.namedNode(`${PKM}locatedInRegion`), factory.namedNode(regionIri), graphNode));
    }
  }
}

/**
 * Emits quads for a classified `unite_pokemon` record.
 *
 * Emitted predicates (in graph `graph/unite/pokemon`):
 * - `rdf:type pkm:Species` (base — UNITE Pokémon are real species)
 * - `pkm:name "Name"`
 * - `rdfs:label "Name"@en`
 *
 * @remarks
 * UNITE role/tier info (`role`, `range`, `damage`, `difficulty`) is omitted here
 * because the UNITE ontology (`pkuni:`) has dedicated predicates for these.
 * The sqush plugin only asserts that the entity exists as a known species.
 */
function emitUnitePokemonQuads(
  input:   Readonly<Record<string, unknown>>,
  factory: DataFactory,
  dataset: { add: (quad: ReturnType<DataFactory['quad']>) => void },
): void {
  const rawPokemon = typeof input['pokemon'] === 'string' ? input['pokemon'] : '';
  const name       = rawPokemon !== '' ? rawPokemon : (typeof input['name'] === 'string' ? input['name'] : '');
  if (name === '') {return;}

  const slug      = toSlug(name);
  const subject   = factory.namedNode(`${BASE_SPECIES}${slug}`);
  const graphNode = factory.namedNode(GRAPH_UNITE);
  const rdfType   = factory.namedNode(RDF_TYPE);
  const rdfsLabel = factory.namedNode(RDFS_LABEL);

  dataset.add(factory.quad(subject, rdfType, factory.namedNode(`${PKM}Species`), graphNode));
  dataset.add(factory.quad(subject, factory.namedNode(`${PKM}name`), strLiteral(name, factory), graphNode));
  dataset.add(factory.quad(subject, rdfsLabel, enLabel(name, factory), graphNode));
}

// ─── Task name ─────────────────────────────────────────────────────────────────

/** Name under which the torreya squash task is registered. */
export const TORREYA_SQUASH_TASK_NAME = 'torreya:squash' as const;

// ─── Dispatch map ──────────────────────────────────────────────────────────────

type QuadEmitter = (
  input:   Readonly<Record<string, unknown>>,
  factory: DataFactory,
  dataset: { add: (quad: ReturnType<DataFactory['quad']>) => void },
) => void;

const EMITTER_DISPATCH: Readonly<Record<string, QuadEmitter>> = {
  'Pokemon':      emitPokemonQuads,
  'Move':         emitMoveQuads,
  'Item':         emitItemQuads,
  'Character':    emitCharacterQuads,
  'TrainerClass': emitTrainerClassQuads,
  'Location':     emitLocationQuads,
  'UnitePokemon': emitUnitePokemonQuads,
  // SyncPair:  skipped — authoritative data from pkmex ontology pipeline
  // Learnset:  skipped — authoritative data from Veekun VG-learnset pipeline
};

// ─── Task function ─────────────────────────────────────────────────────────────

/**
 * Pipeline task: `torreya:squash`.
 *
 * @remarks
 * Branches on `state.classification.type` (set by `classify:conflict`) and
 * calls the appropriate emitter. Records with `classification === null` or with
 * an unrecognized class (quarantined `unknown` or `game`) produce no quads.
 *
 * SyncPair and Learnset records are intentionally skipped: they quarantine
 * during `classify:conflict` (onUnknown = quarantine) since those classes are
 * defined in the config but produce no quads here. The more authoritative
 * sources (pkmex ontology and Veekun VG-learnsets) handle those types.
 *
 * @param next  - Advance function; always called.
 * @param state - Mutable pipeline state.
 */
const torreyaSquashTask = async (
  next:  NextFnInterface,
  state: PipelineStateInterface,
): Promise<void> => {
  const ctx            = state.context;
  const classification = state.classification;

  if (ctx !== undefined && classification !== null) {
    const emitter = EMITTER_DISPATCH[classification.type];
    if (emitter !== undefined) {
      emitter(state.input, ctx.factory, ctx.dataset as unknown as { add: (quad: ReturnType<DataFactory['quad']>) => void });
    }
    // Unrecognized class (SyncPair, Learnset, etc.) — no quads, silent skip.
  }

  await next();
};

// ─── Registration ──────────────────────────────────────────────────────────────

/**
 * Registers the `torreya:squash` task in the global {@link TaskRegistry}.
 *
 * @remarks
 * Safe to call multiple times — `TaskRegistry.register` overwrites any existing
 * task with the same name, so repeated calls are idempotent.
 *
 * @example
 * ```ts
 * import { registerTorreyaPlugin } from './plugins/torreya/squash.task.js';
 * registerTorreyaPlugin();
 * ```
 */
export function registerTorreyaPlugin(): void {
  TaskRegistry.register(TORREYA_SQUASH_TASK_NAME, torreyaSquashTask);
}
