// Deity concept types.

import type { Rarity, PfsLegality, Section, SourceRef, LinkRef } from '../../common.js';

/** A spell rank entry from the `Cleric Spells` line. */
export interface DeityClericSpellRank {
  /** Rank number parsed from the leading "Nth" token (1 → 10). */
  rank:   number;
  /** Spell display names in source order. */
  spells: string[];
}

/** A boon/curse entry (Minor/Moderate/Major × Boon/Curse). */
export interface DeityIntercession {
  tier:  'minor' | 'moderate' | 'major';
  kind:  'boon' | 'curse';
  text:  string;
}

/** A linked deity reference harvested from the body prose. */
export interface DeityRelationship {
  /** Display name of the linked deity. */
  name:      string;
  /** AON Deities.aspx ID from `?ID=N`. */
  deity_id:  number | null;
  /** Verbatim href. */
  href:      string;
}

export interface DeityOutput {
  _type:            'deity';
  url:              string;
  /** Numeric AON Deities.aspx ID extracted from the URL query string. */
  deity_id:         number | null;
  name:             string;
  rarity:           Rarity;
  pfs:              PfsLegality | null;
  legacy:           boolean;
  alt_edition_url:  string | null;
  traits:           string[];
  trait_ids:        Record<string, number>;
  source:           { book: string | null; page: number | null; source_id: number | null };
  sources:          SourceRef[];

  // ─── Devotee Benefits sidebar ──────────────────────────────────────────────
  /** "Constitution or Intelligence" style raw value (not split into options). */
  divine_attribute:      string | null;
  /** "harm or heal" — spell list in raw form. */
  divine_font:           string | null;
  /** "can choose holy or unholy" / "must choose holy" / etc. */
  divine_sanctification: string | null;
  /** Single skill name. */
  divine_skill:          string | null;
  /** Single favored weapon name. */
  favored_weapon:        string | null;
  /** Primary domain names. */
  domains:               string[];
  /** Alternate domain names (post-Remaster pages only). */
  alternate_domains:     string[];

  // ─── Lore / edicts ─────────────────────────────────────────────────────────
  category:             string | null;
  edicts:               string | null;
  anathema:             string | null;
  areas_of_concern:     string | null;
  follower_alignments:  string | null;
  religious_symbol:     string | null;
  sacred_animal:        string | null;
  sacred_colors:        string | null;
  pantheons_covenants:  string[];

  // ─── Cleric spell list ────────────────────────────────────────────────────
  cleric_spells:        DeityClericSpellRank[];

  // ─── Intercessions (Minor/Moderate/Major × Boon/Curse) ────────────────────
  intercessions:        DeityIntercession[];

  // ─── Cross-references ─────────────────────────────────────────────────────
  /** Linked Deities.aspx references harvested from body prose. */
  deity_relationships:  DeityRelationship[];

  // ─── Bookkeeping ───────────────────────────────────────────────────────────
  sections:             Section[];
  raw_fields:           Record<string, string>;
  links:                LinkRef[];
  body_text:            string;
  body_html:            string;
  /** `<meta name="description">` content. */
  meta_description:     string | null;
  /** `<meta name="keywords">` content. */
  meta_keywords:        string | null;
}

// ─── Per-node slice types ─────────────────────────────────────────────────────

/** Fields owned by `extract-deity-base`. */
export interface DeityBaseSlice {
  _type:           'deity';
  url:             string;
  deity_id:        number | null;
  name:            string;
  rarity:          Rarity;
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;
  traits:          string[];
  trait_ids:       Record<string, number>;
  source:          DeityOutput['source'];
  sources:         SourceRef[];
}

/** Fields owned by `extract-deity-devotee-benefits`. */
export interface DeityDevoteeBenefitsSlice {
  divine_attribute:      string | null;
  divine_font:           string | null;
  divine_sanctification: string | null;
  divine_skill:          string | null;
  favored_weapon:        string | null;
  domains:               string[];
  alternate_domains:     string[];
}

/** Fields owned by `extract-deity-edicts-anathema`. */
export interface DeityEdictsAnathemaSlice {
  category:            string | null;
  edicts:              string | null;
  anathema:            string | null;
  areas_of_concern:    string | null;
  follower_alignments: string | null;
  religious_symbol:    string | null;
  sacred_animal:       string | null;
  sacred_colors:       string | null;
  pantheons_covenants: string[];
}

/** Fields owned by `extract-deity-cleric-spells`. */
export interface DeityClericSpellsSlice {
  cleric_spells: DeityClericSpellRank[];
  intercessions: DeityIntercession[];
}

/** Fields owned by `extract-deity-relationships`. */
export interface DeityRelationshipsSlice {
  deity_relationships: DeityRelationship[];
}

/** Fields owned by `extract-deity-meta`. */
export interface DeityMetaSlice {
  // Meta slice owns no projected fields beyond the marker — sections / links /
  // body / meta tags are attached during `finalizeDeity` since they all live
  // on the original CommonExtraction and the page's CheerioAPI handle.
  /** Marker so `state.output` accumulates the slice. */
  __deity_meta_marked: true;
}
