// Generic/condition/trait/hazard concept types.

import type { Rarity, PfsLegality, SourceRef, Section, LinkRef } from '../../common.js';
import type { ConceptOutputBase } from '../../taxonomy.js';

// ─── BaseShape (shared across generic, condition, trait, hazard) ─────────────

export interface BaseShape {
  url:              string;
  name:             string;
  rarity:           Rarity;
  pfs:              PfsLegality | null;
  legacy:           boolean;
  alt_edition_url:  string | null;
  traits:           string[];
  trait_ids:        Record<string, number>;
  source:           SourceShape;
  sources:          SourceRef[];
  sections:         Section[];
  raw_fields:       Record<string, string>;
  links:            LinkRef[];
  body_text:        string;
  body_html:        string;
  meta_description: string | null;
  meta_keywords:    string | null;
}

export interface SourceShape {
  book:      string | null;
  page:      number | null;
  source_id: number | null;
}

// ─── Condition ────────────────────────────────────────────────────────────────

export interface ConditionStage {
  stage:     number;
  text:      string;
  duration:  string | null;
}

export interface ConditionOutputFields extends BaseShape {
  /** Numeric AON condition ID extracted from the URL query string. */
  condition_id: number | null;
  stages:   ConditionStage[];
  /** Other conditions referenced from the body. */
  related_conditions: Array<{ name: string; condition_id: number | null }>;
}

/** Full output shape — `_type` discriminator stamped by the router at chain entry. */
export type ConditionOutput = ConceptOutputBase<'condition'> & ConditionOutputFields;

/** Fields owned by `extract-condition-base`. */
export interface ConditionBaseSlice {
  url:             string;
  condition_id:    number | null;
  name:            string;
  rarity:          Rarity;
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;
  traits:          string[];
  trait_ids:       Record<string, number>;
  source:          SourceShape;
  sources:         SourceRef[];
  /** Level for level-bearing conditions (most have none). */
  level:           number | null;
}

/** Fields owned by `extract-condition-stages`. */
export interface ConditionStagesSlice {
  stages:             ConditionStage[];
  related_conditions: Array<{ name: string; condition_id: number | null }>;
}

// ─── Trait ────────────────────────────────────────────────────────────────────

export interface TraitOutputFields extends BaseShape {
  /** Numeric AON trait ID from the URL query string. */
  trait_id: number | null;
  category: string | null;
}

/** Full output shape — `_type` discriminator stamped by the router at chain entry. */
export type TraitOutput = ConceptOutputBase<'trait'> & TraitOutputFields;

/** Fields owned by `extract-trait-base`. */
export interface TraitBaseSlice {
  url:             string;
  trait_id:        number | null;
  name:            string;
  rarity:          Rarity;
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;
  traits:          string[];
  trait_ids:       Record<string, number>;
  source:          SourceShape;
  sources:         SourceRef[];
}

// ─── Hazard ───────────────────────────────────────────────────────────────────

export interface HazardComponent {
  component: string;
  value:     number;
  notes:     string | null;
  bt:        number | null;
}

export interface HazardRoutine {
  name:         string;
  trigger:      string | null;
  effect:       string;
  actions:      string | null;
}

export interface HazardOutputFields extends BaseShape {
  /** Numeric AON hazard ID from the URL query string. */
  hazard_id:    number | null;
  level:        number | null;
  complexity:   'simple' | 'complex' | null;
  stealth:      { dc: number | null; notes: string | null; raw: string | null };
  description_text: string | null;
  disable:      Array<{ skill: string; dc: number | null; text: string }>;
  defenses: {
    ac:          number | null;
    saves:       { fort: number | null; ref: number | null; will: number | null };
    hardness:    HazardComponent[];
    hp:          HazardComponent[];
    immunities:  string[];
    weaknesses:  Array<{ type: string; value: number }>;
    resistances: Array<{ type: string; value: number; exceptions: string | null }>;
  };
  routines:     HazardRoutine[];
  reset:        string | null;
}

/** Full output shape — `_type` discriminator stamped by the router at chain entry. */
export type HazardOutput = ConceptOutputBase<'hazard'> & HazardOutputFields;

/** Fields owned by `extract-hazard-base`. */
export interface HazardBaseSlice {
  url:             string;
  hazard_id:       number | null;
  name:            string;
  level:           number | null;
  rarity:          Rarity;
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;
  traits:          string[];
  trait_ids:       Record<string, number>;
  source:          SourceShape;
  sources:         SourceRef[];
  complexity:      'simple' | 'complex' | null;
  stealth:         { dc: number | null; notes: string | null; raw: string | null };
  description_text: string | null;
}

/** Fields owned by `extract-hazard-defenses`. */
export interface HazardDefensesSlice {
  defenses: HazardOutputFields['defenses'];
}

/** Fields owned by `extract-hazard-routines`. */
export interface HazardRoutinesSlice {
  routines: HazardRoutine[];
  disable:  Array<{ skill: string; dc: number | null; text: string }>;
}

/** Fields owned by `extract-hazard-reset`. */
export interface HazardResetSlice {
  reset: string | null;
}

// ─── Generic / Unknown ────────────────────────────────────────────────────────

export interface GenericOutputFields extends BaseShape {
  /** Numeric AON entity ID extracted from the URL query string. */
  generic_id: number | null;
  level: number | null;
  level_kind: string | null;
}

/** Full output shape — `_type` discriminator stamped by the router at chain entry. */
export type GenericOutput = ConceptOutputBase<'generic'> & GenericOutputFields;

export interface UnknownOutputFields extends BaseShape {
  /** Numeric AON entity ID extracted from the URL query string. */
  unknown_id: number | null;
}

/** Full output shape — `_type` discriminator stamped by the router at chain entry. */
export type UnknownOutput = ConceptOutputBase<'unknown'> & UnknownOutputFields;
