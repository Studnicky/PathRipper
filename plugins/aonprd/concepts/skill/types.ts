// Skill concept — output types and constants.
import type { Rarity, PfsLegality, SourceRef, ActionCost } from '../../common.js';

/** A single action listed under a skill (Balance, Tumble Through, Squeeze, …). */
export interface SkillAction {
  /** Action name with parenthetical key-ability stripped. */
  name:                string;
  /** Action-cost glyph from the `<span class="action">[label]</span>` tag, if any. */
  action_cost:         ActionCost | null;
  /** Trait pills emitted between the heading and the first `<b>` label. */
  traits:              string[];
  /** Proficiency tier under which the action is listed (Untrained/Trained/…). */
  proficiency:         SkillProficiencyRank | 'untrained' | null;
  /** Source ref text for the action (e.g. "Player Core pg. 233"). */
  source:              string | null;
  /** `<b>Requirements</b>` content, when present. */
  requirements:        string | null;
  /** `<b>Trigger</b>` content, when present (rare on skill actions). */
  trigger:             string | null;
  /** `<b>Frequency</b>` content, when present. */
  frequency:           string | null;
  /** `<b>Cost</b>` content, when present. */
  cost:                string | null;
  /** `<b>Critical Success</b>` outcome text. */
  critical_success:    string | null;
  /** `<b>Success</b>` outcome text. */
  success:             string | null;
  /** `<b>Failure</b>` outcome text. */
  failure:             string | null;
  /** `<b>Critical Failure</b>` outcome text. */
  critical_failure:    string | null;
  /** Prose body of the action (post-`<hr/>` HTML with outcomes stripped). */
  description_html:    string;
  /** Plain-text projection of `description_html`. */
  description_text:    string;
  /** AON action page ID, when the heading anchor points to `Actions.aspx?ID=N`. */
  action_id:           number | null;
}

/** Proficiency-tier rank used both for actions and the Sample Tasks tables. */
export type SkillProficiencyRank = 'trained' | 'expert' | 'master' | 'legendary';

/** A `<b>Tier</b> task description` entry from a Sample-Tasks block. */
export interface SkillProficiencyTier {
  /** Rank label as emitted by AON (lower-cased). */
  rank: SkillProficiencyRank | 'untrained';
  /** Tier task description prose. */
  description: string;
  /** Action name the task is associated with (heading immediately above). */
  action: string | null;
}

export interface SkillOutput {
  url:                 string;
  /** Numeric AON ID extracted from the URL query string. */
  skill_id:            number | null;
  /** Skill display name with the `(Key Ability)` suffix removed. */
  name:                string;
  /** Lower-cased key-ability abbreviation parsed from `Skill (Dex)` style titles. */
  key_ability:         string | null;
  rarity:              Rarity;
  pfs:                 PfsLegality | null;
  legacy:              boolean;
  alt_edition_url:     string | null;
  traits:              string[];
  /** Trait AON IDs keyed by trait name. */
  trait_ids:           Record<string, number>;
  source:              { book: string | null; page: number | null; source_id: number | null };
  /** All source refs on the page (header + body footnotes). */
  sources:             SourceRef[];
  /** Skill prose description, from the lead paragraph above `<details>`. */
  description_html:    string;
  description_text:    string;
  /** Actions emitted as `<h2 class="title">` blocks (Balance, Tumble Through, …). */
  actions:             SkillAction[];
  /** `<b>Trained</b> wooden beam` style sample-task descriptions. */
  proficiency_tiers:   SkillProficiencyTier[];
  /** Additional traits exposed by some skills (e.g. lore skills) — comma-separated list lifted from `<b>Additional Traits</b>`. */
  additional_traits:   string[];
  /** Linked partner skill (rare; appears on Specialty-style entries). */
  corresponding_skill: { name: string; skill_id: number | null } | null;
  raw_fields:          Record<string, string>;
  links:               any[];
  body_text:           string;
  body_html:           string;
  /** `<meta name="description">` content. */
  meta_description:    string | null;
  /** `<meta name="keywords">` content. */
  meta_keywords:       string | null;
}

// ─── Per-node slice types ─────────────────────────────────────────────────────

/** Fields owned by `extract-skill-base`. */
export interface SkillBaseSlice {
  url:              string;
  skill_id:         number | null;
  name:             string;
  key_ability:      string | null;
  rarity:           Rarity;
  pfs:              PfsLegality | null;
  legacy:           boolean;
  alt_edition_url:  string | null;
  traits:           string[];
  trait_ids:        Record<string, number>;
  source:           SkillOutput['source'];
  sources:          SourceRef[];
  description_html: string;
  description_text: string;
}

/** Fields owned by `extract-skill-actions`. */
export interface SkillActionsSlice {
  actions: SkillAction[];
}

/** Fields owned by `extract-skill-proficiency-tiers`. */
export interface SkillProficiencyTiersSlice {
  proficiency_tiers: SkillProficiencyTier[];
}

/** Fields owned by `extract-skill-meta`. */
export interface SkillMetaSlice {
  /** `<b>Additional Traits</b>` field, comma-split into a string list. Empty when absent. */
  additional_traits:   string[];
  /** `<b>Corresponding Skill</b>` link, parsed to {name, skill_id}. Null when absent. */
  corresponding_skill: { name: string; skill_id: number | null } | null;
  body_text:           string;
  body_html:           string;
  links:               any[];
  meta_description:    string | null;
  meta_keywords:       string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const ACTION_LABEL_TO_COST: ReadonlyMap<string, ActionCost> = new Map<string, ActionCost>([
  ['one-action',     'one-action'],
  ['single-action',  'one-action'],
  ['two-actions',    'two-actions'],
  ['three-actions',  'three-actions'],
  ['reaction',       'reaction'],
  ['free-action',    'free-action'],
]);

export const KEY_ABILITY_RE = /\s*\(([^)]+)\)\s*$/;

export const PROFICIENCY_RANKS: ReadonlyArray<SkillProficiencyRank | 'untrained'> = [
  'untrained', 'trained', 'expert', 'master', 'legendary',
];

export const PROFICIENCY_RANK_SET: ReadonlySet<string> = new Set(PROFICIENCY_RANKS);

/** AON labels every per-slice helper has lifted into structured fields. */
export const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Source',
  'Requirements',
  'Trigger',
  'Frequency',
  'Cost',
  'Critical Success',
  'Success',
  'Failure',
  'Critical Failure',
  'Trained',
  'Untrained',
  'Expert',
  'Master',
  'Legendary',
  // Per-skill metadata blocks (rare; ~3 records carry these).
  'Additional Traits',
  'Corresponding Skill',
];
