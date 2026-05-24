// Class concept types.

import type { Rarity, PfsLegality, Section, SourceRef, LinkRef } from '../../common.js';

export interface ClassOutput {
  url:                   string;
  class_id:             number | null;
  name:                  string;
  rarity:                Rarity;
  pfs:                   PfsLegality | null;
  legacy:                boolean;
  alt_edition_url:       string | null;
  traits:                string[];
  trait_ids:             Record<string, number>;
  source:                { book: string | null; page: number | null; source_id: number | null };
  sources:               SourceRef[];
  sections:              Section[];
  raw_fields:            Record<string, string>;
  links:                 LinkRef[];
  body_text:             string;
  body_html:             string;
  meta_description:      string | null;
  meta_keywords:         string | null;
  /** Inline `<b>Key Attribute: VALUE</b>` or legacy field. */
  key_attribute:         string | null;
  /** Raw `<b>Hit Points: …</b>` value text. */
  hit_points_text:       string | null;
  /** Numeric HP per level if the inline label leads with an integer. */
  hp_per_level:          number | null;
  /** Map of Initial Proficiencies category → proficiency text. */
  initial_proficiencies: Record<string, string>;
  /** Class DC proficiency text when AON exposes it as a `<b>Class DC</b>` field. */
  class_dc:              string | null;
  /** Subclass nav entries (`{name, description}`) discovered as h3 sections. */
  subclasses:            Array<{ name: string; description: string }>;
  /** Per-level progression parsed from the concatenated `Class Features` orphan string. */
  progression:           Array<{ level: number; features: string[] }>;
  /** Subclass-specific feature labels lifted from bare `<b>` tags in the head. */
  subclass_features:     Array<{ name: string; description: string }>;
}

// ─── Per-slice shapes ─────────────────────────────────────────────────────────

export interface ClassBaseSlice {
  url:                   string;
  class_id:             number | null;
  name:                  string;
  rarity:                Rarity;
  pfs:                   PfsLegality | null;
  legacy:                boolean;
  alt_edition_url:       string | null;
  traits:                string[];
  trait_ids:             Record<string, number>;
  source:                { book: string | null; page: number | null; source_id: number | null };
  sources:               SourceRef[];
  key_attribute:         string | null;
  hit_points_text:       string | null;
  hp_per_level:          number | null;
  initial_proficiencies: Record<string, string>;
  class_dc:              string | null;
}

export interface ClassProgressionSlice {
  progression: Array<{ level: number; features: string[] }>;
}

export interface ClassSubclassesSlice {
  subclasses:        Array<{ name: string; description: string }>;
  subclass_features: Array<{ name: string; description: string }>;
}

export interface ClassMetaSlice {
  sections: Section[];
}
