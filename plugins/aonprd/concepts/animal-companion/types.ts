// Animal-companion output types and constants.
import type {
  ActionCost,
  LinkRef,
  PfsLegality,
  Rarity,
  Section,
  SourceRef,
} from '../../common.js';
import type { ConceptOutputBase } from '../../taxonomy.js';

/** Companion page variant inferred from the `Type=` URL parameter. */
export type AnimalCompanionVariant = 'base' | 'unique' | 'specialized' | 'advancement';

/** Reference to another Companions.aspx entry (e.g. the base companion for a Unique uplift). */
export interface AnimalCompanionRef {
  /** Display text of the anchor. */
  name:            string;
  /** Numeric AON Companions.aspx ID, when the link carries `?ID=`. */
  companion_id:    number | null;
  /** Variant qualifier parsed from `?Type=` query parameter, when present. */
  variant:         AnimalCompanionVariant | null;
  /** Verbatim href. */
  href:            string;
}

/** Six-stat ability score modifier line. */
export interface AnimalCompanionAbilities {
  str: number | null;
  dex: number | null;
  con: number | null;
  int: number | null;
  wis: number | null;
  cha: number | null;
}

/** A single Strike line (Melee/Ranged). */
export interface AnimalCompanionStrike {
  /** "Melee" or "Ranged". */
  kind:        'melee' | 'ranged';
  /** Strike name (e.g. "beak", "talon"). */
  name:        string;
  /** Action cost glyph parsed from inside the strike line, when present. */
  action_cost: ActionCost | null;
  /** Strike traits parsed from the `(…)` cluster, e.g. ["finesse", "agile"]. */
  traits:      string[];
  /** Damage expression, e.g. "1d6 piercing", "1d4 slashing". */
  damage:      string | null;
}

/** Verbatim uplift modification harvested from a Unique companion page. */
export interface AnimalCompanionModification {
  /** Label text (e.g. "Flaming Attacks", "Burning Glow"). */
  label: string;
  /** Modification body text. */
  text:  string;
  /** Verbatim modification body HTML. */
  html:  string;
}

export interface AnimalCompanionOutputFields {
  url:             string;
  /** Numeric AON Companions.aspx ID extracted from the URL query string. */
  companion_id:    number | null;
  /** Variant inferred from the URL `Type=` parameter. */
  variant:         AnimalCompanionVariant;
  name:            string;
  rarity:          Rarity;
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;
  traits:          string[];
  trait_ids:       Record<string, number>;
  source:          { book: string | null; page: number | null; source_id: number | null };
  sources:         SourceRef[];
  /** Reference to the base companion when this page is a Unique uplift. */
  base_companion:  AnimalCompanionRef | null;
  /** Flavor sentence immediately after the Source line (when the page is a base statblock). */
  description:     string | null;

  // ─── Stats slice (base statblock pages only) ──────────────────────────────
  size:            string | null;
  abilities:       AnimalCompanionAbilities;
  hit_points:      number | null;
  /** Skill specialty line, e.g. "Acrobatics", "Thievery (Palm an Object or Steal only)". */
  skill:           string | null;
  /** Senses line, e.g. "low-light vision, scent (imprecise) 30 feet". */
  senses:          string | null;
  /** Speed expression, e.g. "10 feet, fly 60 feet". */
  speed:           string | null;

  // ─── Combat slice ─────────────────────────────────────────────────────────
  strikes:           AnimalCompanionStrike[];
  /** Support Benefit description (free text). */
  support_benefit:   string | null;
  /** Advanced Maneuver name (e.g. "Pterosaur Swoop"). */
  advanced_maneuver: string | null;

  // ─── Advancement slice ────────────────────────────────────────────────────
  /** Advanced Maneuver action prose (action cost + body) when present as a sub-heading. */
  advanced_maneuver_action_cost: ActionCost | null;
  advanced_maneuver_body:        string | null;
  /** Verbatim uplift modifications (Unique pages). */
  modifications:                 AnimalCompanionModification[];

  // ─── Bookkeeping ───────────────────────────────────────────────────────────
  sections:        Section[];
  raw_fields:      Record<string, string>;
  links:           LinkRef[];
  body_text:       string;
  body_html:       string;
  /** `<meta name="description">` content. */
  meta_description: string | null;
  /** `<meta name="keywords">` content. */
  meta_keywords:    string | null;
}

/** Full output shape — `_type` discriminator stamped by the router at chain entry. */
export type AnimalCompanionOutput = ConceptOutputBase<'animal-companion'> & AnimalCompanionOutputFields;

// ─── Per-node slice types ─────────────────────────────────────────────────

export interface AnimalCompanionBaseSlice {
  url:             string;
  companion_id:    number | null;
  variant:         AnimalCompanionVariant;
  name:            string;
  rarity:          Rarity;
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;
  traits:          string[];
  trait_ids:       Record<string, number>;
  source:          AnimalCompanionOutputFields['source'];
  sources:         SourceRef[];
  base_companion:  AnimalCompanionRef | null;
  description:     string | null;
}

export interface AnimalCompanionStatsSlice {
  size:       string | null;
  abilities:  AnimalCompanionAbilities;
  hit_points: number | null;
  skill:      string | null;
  senses:     string | null;
  speed:      string | null;
}

export interface AnimalCompanionCombatSlice {
  strikes:           AnimalCompanionStrike[];
  support_benefit:   string | null;
  advanced_maneuver: string | null;
}

export interface AnimalCompanionAdvancementSlice {
  advanced_maneuver_action_cost: ActionCost | null;
  advanced_maneuver_body:        string | null;
  modifications:                 AnimalCompanionModification[];
}

export interface AnimalCompanionMetaSlice {
  /** Marker so `state.output` accumulates the slice. */
  __animal_companion_meta_marked: true;
}
