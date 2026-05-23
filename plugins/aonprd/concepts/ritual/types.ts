/**
 * Ritual concept — type definitions.
 *
 * Defines RitualOutput, SpellOutput, and all slice interfaces. Inlines
 * spell-shape types (SpellKind, Tradition, SpellOutcome, AfflictionStage,
 * Affliction, HeightenedEntry) and per-slice discriminators.
 */

export type SpellKind = 'spell' | 'cantrip' | 'focus' | 'ritual';
export type Tradition = 'arcane' | 'divine' | 'occult' | 'primal' | 'elemental';

export interface SpellOutcome {
  critical_success: string | null;
  success: string | null;
  failure: string | null;
  critical_failure: string | null;
}

export interface AfflictionStage {
  stage: number;
  body_text: string;
  duration: string | null;
}

export interface Affliction {
  name: string;
  type: string | null;
  level: number | null;
  saving_throw: string | null;
  onset: string | null;
  maximum_duration: string | null;
  stages: AfflictionStage[];
  body_html: string;
}

export interface HeightenedEntry {
  rank_label: string;
  rank: number | null;
  increment: number | null;
  body_text: string;
  body_html: string;
}

/**
 * Ritual output — structurally identical to SpellOutput except for the
 * discriminator. AON renders rituals using the spell page template, so the
 * extraction code reuses every spell helper; the only difference is the
 * `_type` discriminator that flags the concept downstream.
 */
export type RitualOutput = Omit<SpellOutput, '_type'> & { _type: 'ritual' };

export interface SpellOutput {
  _type: 'spell';
  url: string;
  /** Numeric AON ID extracted from the URL query string. */
  spell_id: number | null;
  name: string;
  kind: SpellKind;
  rank: number | null;
  rarity: import('../../common.js').Rarity;
  pfs: import('../../common.js').PfsLegality | null;
  legacy: boolean;
  alt_edition_url: string | null;
  action_cost: import('../../common.js').ActionCost | null;
  traits: string[];
  /** Trait AON IDs keyed by trait name (e.g. `{ "Necromancy": 117 }`). */
  trait_ids: Record<string, number>;
  source: { book: string | null; page: number | null; source_id: number | null };
  /** All source refs on the page (header + body footnotes). */
  sources: import('../../common.js').SourceRef[];
  traditions: Tradition[];
  spell_list: string | null;
  bloodlines: Array<{ name: string; bloodline_id: number | null }>;
  cult: Array<{ name: string; cult_id: number | null }>;
  domain: Array<{ name: string; domain_id: number | null }>;
  /**
   * Deities that grant this spell, from the `<b>Deities</b>` field.
   * Applies primarily to divine-granted spells and focus spells.
   */
  deities: Array<{ name: string; deity_id: number | null }>;
  /**
   * Oracle mysteries granting this spell, from the `<b>Mystery</b>` field.
   */
  mysteries: Array<{ name: string; mystery_id: number | null }>;
  /**
   * Witch patron themes granting this spell, from the `<b>Patron Theme</b>` field.
   */
  patron_themes: Array<{ name: string; patron_id: number | null }>;
  /**
   * Spell catalyst items, from the `<b>Catalysts</b>` field.
   */
  catalysts: Array<{ name: string; equipment_id: number | null }>;
  /**
   * Witch lesson that grants this focus spell, from the `<b>Lesson</b>` field.
   * Populated only on witch focus spells.
   */
  lesson: { name: string; lesson_id: number | null } | null;
  /**
   * Access restriction text, from the `<b>Access</b>` field.
   * Present on uncommon/rare spells with non-standard access requirements.
   */
  access: string | null;
  /**
   * Adventure Path or product spoiler notice, from the `<h2 class="title">This Spell
   * may contain spoilers from …</h2>` element. Null when no notice is present.
   */
  spoiler_source: string | null;
  /**
   * For rituals: number of secondary casters required, from `<b>Secondary Casters</b>`.
   */
  ritual_secondary_casters: number | null;
  /**
   * For rituals: primary skill check(s) required, from `<b>Primary Check</b>`.
   */
  ritual_primary_check: string | null;
  /**
   * For rituals: secondary skill check(s) required, from `<b>Secondary Checks</b>`.
   */
  ritual_secondary_checks: string | null;
  cast: { actions: import('../../common.js').ActionCost | null; components: string[]; time: string | null; raw: string | null };
  trigger: string | null;
  range: string | null;
  area: string | null;
  targets: string | null;
  /**
   * Remaster pages use `<b>Defense</b>` (e.g. "AC", "basic Fortitude").
   * Populated alongside `saving_throw` when both are present.
   */
  defense: string | null;
  saving_throw: { kind: string | null; basic: boolean; raw: string | null } | null;
  duration: string | null;
  cost: string | null;
  requirements: string | null;
  description_html: string;
  description_text: string;
  outcomes: SpellOutcome;
  affliction: Affliction | null;
  heightened: HeightenedEntry[];
  raw_fields: Record<string, string>;
  links: import('../../common.js').LinkRef[];
  /** `<meta name="description">` content. */
  meta_description: string | null;
  /** `<meta name="keywords">` content. */
  meta_keywords: string | null;
}

/** Fields owned by `extract-ritual-base`. */
export interface RitualBaseSlice {
  _type:           'spell';
  url:             string;
  spell_id:        number | null;
  name:            string;
  kind:            SpellKind;
  rank:            number | null;
  rarity:          import('../../common.js').Rarity;
  pfs:             import('../../common.js').PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;
  action_cost:     import('../../common.js').ActionCost | null;
  traits:          string[];
  trait_ids:       Record<string, number>;
  source:          SpellOutput['source'];
  sources:         import('../../common.js').SourceRef[];
}

/** Fields owned by `extract-ritual-cast`. */
export interface RitualCastSlice {
  cast:         SpellOutput['cast'];
  trigger:      string | null;
  range:        string | null;
  area:         string | null;
  targets:      string | null;
  defense:      string | null;
  saving_throw: SpellOutput['saving_throw'];
  duration:     string | null;
  cost:         string | null;
  requirements: string | null;
}

/** Fields owned by `extract-ritual-outcomes`. */
export interface RitualOutcomesSlice {
  description_html: string;
  description_text: string;
  outcomes:         SpellOutcome;
}

/** Fields owned by `extract-ritual-affliction`. */
export interface RitualAfflictionSlice {
  affliction:               Affliction | null;
  ritual_primary_check:     string | null;
  ritual_secondary_casters: number | null;
  ritual_secondary_checks:  string | null;
}

/** Fields owned by `extract-ritual-heightened`. */
export interface RitualHeightenedSlice {
  heightened: HeightenedEntry[];
}

/** Fields owned by `extract-ritual-meta`. */
export interface RitualMetaSlice {
  traditions:     Tradition[];
  spell_list:     string | null;
  bloodlines:     SpellOutput['bloodlines'];
  cult:           SpellOutput['cult'];
  domain:         SpellOutput['domain'];
  deities:        SpellOutput['deities'];
  mysteries:      SpellOutput['mysteries'];
  patron_themes:  SpellOutput['patron_themes'];
  catalysts:      SpellOutput['catalysts'];
  lesson:         SpellOutput['lesson'];
  access:         string | null;
  spoiler_source: string | null;
}
