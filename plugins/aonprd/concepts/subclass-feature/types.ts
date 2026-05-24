// Subclass-feature concept — output types and constants.
import type { Rarity, PfsLegality, SourceRef, Section, LinkRef } from '../../common.js';

/** A spell entry referenced from a subclass-feature spell list. */
export interface SubclassFeatureSpellRef {
  /** Display name of the spell. */
  name:     string;
  /** AON Spells.aspx ID, or `null` when no anchor was present. */
  spell_id: number | null;
}

/** A rank-indexed group of granted spells (cantrip / 1st / advanced / greater / …). */
export interface SubclassFeatureSpellGroup {
  /** Rank token as it appeared in source (e.g. `'cantrip'`, `'1st'`, `'initial'`, `'advanced'`). */
  rank:   string;
  /** Spells listed for the rank, in source order. */
  spells: SubclassFeatureSpellRef[];
}

/** A granted feature/ability with its level (when one is parseable) and body. */
export interface SubclassFeatureGrantedFeature {
  /** Display name of the granted feature (e.g. "Blood Magic—Eerie Veil"). */
  name:      string;
  /** Level prefix parsed from the heading, when present. */
  level:     number | null;
  /** Verbatim inner HTML of the feature's body fragment. */
  body_html: string;
  /** Plain-text rendering of the body fragment. */
  body_text: string;
}

export interface SubclassFeatureOutput {
  url:             string;
  subclass_feature_id:       number | null;
  name:            string;
  /** URL-kind discriminator: `'bloodline' | 'mystery' | 'patron' | …`. */
  subclass_family: string;
  /** Lowercase class slug that owns the subclass slot (e.g. `'sorcerer'`). Null for cross-class kinds. */
  parent_class:    string | null;
  rarity:          Rarity;
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;
  traits:          string[];
  trait_ids:       Record<string, number>;
  source:          { book: string | null; page: number | null; source_id: number | null };
  sources:         SourceRef[];
  /** Common subclass header fields lifted into a property bag (keyed by the original AON label). */
  feature_fields:  Record<string, string>;
  /** Spell list if the subclass grants spells (Bloodlines, Mysteries, Patrons, ResearchFields, …). */
  granted_spells:  SubclassFeatureSpellGroup[];
  /** Granted feats / abilities (e.g. Bloodline Spell, Patron Lesson, Order Spell). */
  granted_features: SubclassFeatureGrantedFeature[];
  /** Body sections (anything that doesn't fall into other slots). */
  sections:        Section[];
  raw_fields:      Record<string, string>;
  links:           LinkRef[];
  body_text:       string;
  body_html:       string;
  meta_description: string | null;
  meta_keywords:   string | null;
}

// ─── Per-node slice types ─────────────────────────────────────────────────────

/** Fields owned by `extract-subclass-feature-base`. */
export interface SubclassFeatureBaseSlice {
  url:             string;
  subclass_feature_id:       number | null;
  name:            string;
  subclass_family: string;
  parent_class:    string | null;
  rarity:          Rarity;
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;
  traits:          string[];
  trait_ids:       Record<string, number>;
  source:          SubclassFeatureOutput['source'];
  sources:         SourceRef[];
}

/** Fields owned by `extract-subclass-feature-fields`. */
export interface SubclassFeatureFieldsSlice {
  feature_fields: Record<string, string>;
}

/** Fields owned by `extract-subclass-feature-spells`. */
export interface SubclassFeatureSpellsSlice {
  granted_spells: SubclassFeatureSpellGroup[];
}

/** Fields owned by `extract-subclass-feature-features`. */
export interface SubclassFeatureFeaturesSlice {
  granted_features: SubclassFeatureGrantedFeature[];
}

/** Fields owned by `extract-subclass-feature-meta`. */
export interface SubclassFeatureMetaSlice {
  /** Marker so `state.output` accumulates the slice. */
  __subclass_feature_meta_marked: true;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * URL-kind → {subclass_family, parent_class} table.
 *
 * Keys match the URL path (lowercase, no `.aspx`) so the lookup is a direct
 * `URL_KIND_INFO.get(detectUrlKind(url))`. Adding a new URL kind only requires
 * extending this table — every extraction slice resolves family/class through
 * it.
 *
 * `subclass_family` is the canonical singular name used on `_type:
 * 'subclass-feature'` output. `parent_class` is the lowercase class slug that
 * owns the subclass slot, or `null` when the URL kind spans multiple classes
 * (e.g. `mythicdestinies`, `heritages`).
 */
export const URL_KIND_INFO_ENTRIES = [
  ['bloodlines',         { subclass_family: 'bloodline',          parent_class: 'sorcerer'    }],
  ['mysteries',          { subclass_family: 'mystery',            parent_class: 'oracle'      }],
  ['patrons',            { subclass_family: 'patron',             parent_class: 'witch'       }],
  ['lessons',            { subclass_family: 'lesson',             parent_class: 'witch'       }],
  ['apparitions',        { subclass_family: 'apparition',         parent_class: 'animist'     }],
  ['causes',             { subclass_family: 'cause',              parent_class: 'champion'    }],
  ['eidolons',           { subclass_family: 'eidolon',            parent_class: 'summoner'    }],
  ['researchfields',     { subclass_family: 'research-field',     parent_class: 'alchemist'   }],
  ['hybridstudies',      { subclass_family: 'hybrid-study',       parent_class: 'magus'       }],
  ['methodologies',      { subclass_family: 'methodology',        parent_class: 'investigator' }],
  ['muses',              { subclass_family: 'muse',               parent_class: 'bard'        }],
  ['ways',               { subclass_family: 'way',                parent_class: 'gunslinger'  }],
  ['huntersedge',        { subclass_family: 'hunters-edge',       parent_class: 'ranger'      }],
  ['implements',         { subclass_family: 'implement',          parent_class: 'thaumaturge' }],
  ['consciousminds',     { subclass_family: 'conscious-mind',     parent_class: 'psychic'     }],
  ['subconsciousminds',  { subclass_family: 'subconscious-mind',  parent_class: 'psychic'     }],
  ['rackets',            { subclass_family: 'racket',             parent_class: 'rogue'       }],
  ['druidicorders',      { subclass_family: 'druidic-order',      parent_class: 'druid'       }],
  ['instincts',          { subclass_family: 'instinct',           parent_class: 'barbarian'   }],
  ['styles',             { subclass_family: 'style',              parent_class: 'monk'        }],
  ['arcaneschools',      { subclass_family: 'arcane-school',      parent_class: 'wizard'      }],
  ['arcanethesis',       { subclass_family: 'arcane-thesis',      parent_class: 'wizard'      }],
  ['mythicdestinies',    { subclass_family: 'mythic-destiny',     parent_class: null          }],
  ['ikons',              { subclass_family: 'ikon',               parent_class: 'exemplar'    }],
  ['epithets',           { subclass_family: 'epithet',            parent_class: 'exemplar'    }],
  ['deviantfeats',       { subclass_family: 'deviant-feat',       parent_class: null          }],
  ['heritages',          { subclass_family: 'heritage',           parent_class: null          }],
  ['elements',           { subclass_family: 'element',            parent_class: 'kineticist'  }],
  ['followers',          { subclass_family: 'follower',           parent_class: 'commander'   }],
  ['practices',          { subclass_family: 'practice',           parent_class: 'inventor'    }],
  ['hellknightorders',   { subclass_family: 'hellknight-order',   parent_class: null          }],
  ['doctrines',          { subclass_family: 'doctrine',           parent_class: 'cleric'      }],
  ['tenets',             { subclass_family: 'tenet',              parent_class: 'champion'    }],
  ['innovations',        { subclass_family: 'innovation',         parent_class: 'inventor'    }],
] as const satisfies ReadonlyArray<readonly [string, { subclass_family: string; parent_class: string | null }]>;

/** Lookup map derived from {@link URL_KIND_INFO_ENTRIES}. */
export const URL_KIND_INFO: ReadonlyMap<string, { subclass_family: string; parent_class: string | null }> =
  new Map<string, { subclass_family: string; parent_class: string | null }>(URL_KIND_INFO_ENTRIES);

/** Headings whose section bodies we read as the spell-list source (modern layout). */
export const SPELL_LIST_HEADINGS: ReadonlyArray<string> = [
  'granted spells',       // mysteries
  'sorcerous gifts',      // bloodlines (cantrip + 1st + … list)
  'bloodline spells',     // bloodlines (initial/advanced/greater)
  'revelation spells',    // mysteries (initial/advanced/greater)
  'patron spells',        // patrons (initial/advanced/greater)
  'order spells',         // druidic orders
  'school spells',        // arcane schools
  'arcane school spells',
];

/**
 * Labels the property-bag harvest must NEVER capture as `feature_fields`:
 * the page-level Source field (already lifted into `sources`) plus every
 * heading we read as a structured spell-list. Note: the legacy `<b>Spell
 * List</b>` pointer label (which holds a tradition name, not a rank list) is
 * deliberately NOT excluded — it lands in `feature_fields` like other header
 * scalars.
 */
export const STRUCTURED_HEADING_LABELS: ReadonlySet<string> = new Set([
  'source',
  ...SPELL_LIST_HEADINGS,
]);

/** Rank tokens we recognise inside a spell list value (cantrip / 1st / initial / advanced / greater / etc.). */
export const RANK_TOKEN_RE = /(?:^|[\s,;>(])(cantrip|initial|advanced|greater|focus|signature|\d+(?:st|nd|rd|th))\s*:/gi;

/** AON labels claimed by upstream subclass-feature slices. */
export const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Source',
  // Common subclass-feature header labels lifted into feature_fields property bag.
  'Usage', 'Trigger', 'Frequency', 'Requirements', 'Tradition', 'Traditions',
  'Home Plane', 'Archetype', 'Key Ability', 'Psyche Action',
  'Bloodline Skills', 'Mystery Skill', 'Patron Skill', 'Order Skill', 'Order Feat',
  'Spell List', 'Skill',
  // Class-feature inline cards.
  "Slinger's Reload", 'Deeds', 'Way Skill',
  // Statblock-shaped subclass content (eidolons, apparitions).
  'Damage', 'Str', 'Dex', 'Con', 'Int', 'Wis', 'Cha',
  'Hit Points', 'Size', 'Speed', 'Senses', 'Languages',
  // Sample-class header (some subclass pages embed a `Class` link).
  'Class',
  // Follower / commander kit fields.
  'Kit Armor', 'Skills', 'Follower Ability',
  'Experienced Advancement', 'Veteran Advancement', 'Exceptional Advancement',
  // Misc inline labels in subclass bodies (granted feat/strike cards).
  'Melee', 'Effect', 'Alignment', 'Traits (Variable)', 'Cost', 'Prerequisites',
  'Critical Success', 'Success', 'Critical Failure', 'Failure',
  // Inline ability-card names occasionally embedded in subclass feature bodies.
  'Reckless Attack', 'Share the Pain', 'Medic\'s Treatment', 'Medic\'s Treatment',
  'Quick Treatment', 'Exploit Injury',
  // Strike/spell-card residue inside subclass-granted feature bodies.
  'Range', 'Take Aim', 'Following Shot', 'Ammunition',
];
