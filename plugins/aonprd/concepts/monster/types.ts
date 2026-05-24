/**
 * Monster concept — type definitions.
 *
 * Defines all MonsterOutput, slice interfaces, ability/strike/spell-list
 * structures, and per-slice discriminators. Constants: ACTION_LABEL_TO_COST,
 * KNOWN_LABELS, STAGE_LABEL_RE, SPELL_LIST_LABEL_RE, ABILITY_NAMES.
 */
import type { ActionCost, SourceRef, LinkRef } from '../../common.js';
import type { ConceptOutputBase } from '../../taxonomy.js';

export type AbilityScore = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
export type SaveName = 'fort' | 'ref' | 'will';

export interface MonsterAbility {
  name: string;
  actions: ActionCost | null;
  traits: string[];
  frequency: string | null;
  trigger: string | null;
  requirements: string | null;
  effect: string | null;
  saving_throw: { dc: number; save: SaveName | null; basic: boolean } | null;
  stages: Array<{ stage: number; text: string }>;
  body_html: string;
  body_text: string;
}

export interface MonsterStrike {
  kind: 'melee' | 'ranged';
  action: ActionCost | null;
  weapon: string;
  attack_bonus: number | null;
  map_bonuses: [number, number] | null;
  traits: string[];
  damage: Array<{ dice: string; type: string; persistent: boolean }>;
  effects: string | null;
}

export interface MonsterSpellList {
  tradition: string | null;
  kind: 'spells' | 'innate' | 'focus' | 'rituals';
  dc: number | null;
  attack: number | null;
  slots: Array<{ rank: string; spells: Array<{ name: string; frequency: string | null; count: number | null }> }>;
}

export interface MonsterOutputFields {
  url: string;
  /** Numeric AON ID extracted from the URL query string. */
  monster_id: number | null;
  name: string;
  level: number | null;
  rarity: 'common' | 'uncommon' | 'rare' | 'unique';
  size: string | null;
  alignment: string | null;
  traits: string[];
  /** Trait AON IDs keyed by trait name. */
  trait_ids: Record<string, number>;
  source: { book: string | null; page: number | null; source_id: number | null };
  /** All source refs on the page (header + body footnotes). */
  sources: SourceRef[];
  alt_edition_url: string | null;
  pfs: 'standard' | 'limited' | 'restricted' | null;
  /** True when the page carries a `legacy-content-warning` h3 heading (OGL content). */
  is_legacy: boolean;
  /**
   * URL of the creature illustration linked from `<a class="monster-art-link">`,
   * relative to `https://2e.aonprd.com`. Null when no art is present.
   */
  creature_art: string | null;
  /**
   * Flavor/lore text from the `<span class="hide-on-print">` block that precedes
   * the stat block. Present on nearly all monster pages.
   */
  flavor_text: string | null;
  recall_knowledge: { dc: number | null; lores: Array<{ trait: string; skill: string }>; raw: string | null };
  perception: { modifier: number | null; senses: string[]; raw: string | null };
  languages: { languages: string[]; special: string[]; raw: string | null };
  skills: Array<{ name: string; modifier: number; conditionals: Array<{ bonus: number; context: string }> }>;
  abilities: Record<AbilityScore, number | null>;
  items: string[];
  ac: { value: number | null; conditional: string | null; saves_note: string | null };
  saves: Record<SaveName, number | null>;
  hp: { value: number | null; special: string | null };
  hardness: number | null;
  immunities: string[];
  weaknesses: Array<{ type: string; value: number }>;
  resistances: Array<{ type: string; value: number; exceptions: string | null }>;
  speed: { walk: number | null; burrow: number | null; climb: number | null; fly: number | null; swim: number | null; special: string | null };
  strikes: MonsterStrike[];
  spell_lists: MonsterSpellList[];
  top_abilities: MonsterAbility[];
  defensive_abilities: MonsterAbility[];
  offensive_abilities: MonsterAbility[];
  variants: Array<{ kind: 'elite' | 'normal' | 'weak' | 'pwl'; url: string }>;
  /**
   * Monster family group links from the `<b>Related Groups</b>` field.
   * Multiple groups indicate the monster spans families (e.g. Elementals).
   */
  family_links: Array<{ name: string; family_id: number | null }>;
  raw_fields: Record<string, string>;
  links: LinkRef[];
  body_text: string;
  body_html: string;
  /** `<meta name="description">` content. */
  meta_description: string | null;
  /** `<meta name="keywords">` content. */
  meta_keywords: string | null;
}

/** Full output shape — `_type` discriminator stamped by the router at chain entry. */
export type MonsterOutput = ConceptOutputBase<'monster'> & MonsterOutputFields;

// ─── Per-node slice types ─────────────────────────────────────────────────────

/** Fields owned by `extract-monster-base`. */
export interface MonsterBaseSlice {
  url:              string;
  monster_id:       number | null;
  name:             string;
  level:            number | null;
  rarity:           MonsterOutput['rarity'];
  size:             string | null;
  alignment:        string | null;
  traits:           string[];
  trait_ids:        Record<string, number>;
  source:           MonsterOutput['source'];
  sources:          SourceRef[];
  alt_edition_url:  string | null;
  pfs:              MonsterOutput['pfs'];
  is_legacy:        boolean;
  creature_art:     string | null;
  flavor_text:      string | null;
  recall_knowledge: MonsterOutput['recall_knowledge'];
  perception:       MonsterOutput['perception'];
  languages:        MonsterOutput['languages'];
  skills:           MonsterOutput['skills'];
  abilities:        Record<AbilityScore, number | null>;
  items:            string[];
}

/** Fields owned by `extract-monster-defenses`. */
export interface MonsterDefensesSlice {
  ac:          MonsterOutput['ac'];
  saves:       Record<SaveName, number | null>;
  hp:          MonsterOutput['hp'];
  hardness:    number | null;
  immunities:  string[];
  weaknesses:  MonsterOutput['weaknesses'];
  resistances: MonsterOutput['resistances'];
}

/** Fields owned by `extract-monster-offense`. */
export interface MonsterOffenseSlice {
  speed:       MonsterOutput['speed'];
  strikes:     MonsterStrike[];
  spell_lists: MonsterSpellList[];
}

/** Fields owned by `extract-monster-abilities`. */
export interface MonsterAbilitiesSlice {
  top_abilities:       MonsterAbility[];
  defensive_abilities: MonsterAbility[];
  offensive_abilities: MonsterAbility[];
}

/** Fields owned by `extract-monster-meta`. */
export interface MonsterMetaSlice {
  variants:     MonsterOutput['variants'];
  family_links: MonsterOutput['family_links'];
}

export const ACTION_LABEL_TO_COST: ReadonlyMap<string, ActionCost> = new Map<string, ActionCost>([
  ['one-action', 'one-action'], ['single-action', 'one-action'],
  ['two-actions', 'two-actions'], ['three-actions', 'three-actions'],
  ['reaction', 'reaction'], ['free-action', 'free-action'],
]);

export const KNOWN_LABELS: ReadonlySet<string> = new Set<string>([
  'source', 'recall knowledge', 'perception', 'languages', 'skills',
  'str', 'dex', 'con', 'int', 'wis', 'cha',
  'ac', 'fort', 'ref', 'will', 'hp', 'hardness',
  'immunities', 'weaknesses', 'resistances',
  'speed', 'melee', 'ranged', 'damage',
  'cast', 'trigger', 'frequency', 'effect', 'requirements',
  'saving throw', 'maximum duration', 'onset', 'items',
]);

export const STAGE_LABEL_RE = /^stage\s+\d+$/i;
export const SPELL_LIST_LABEL_RE = /(?:Innate Spells|Focus Spells|Rituals|Spells)$/i;
export const ABILITY_NAMES: ReadonlyArray<AbilityScore> = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
