// Familiar output types.
import type {
  ActionCost,
  LinkRef,
  PfsLegality,
  Rarity,
  Section,
  SourceRef,
} from '../../common.js';

/** Reference to another familiar ability (`Familiars.aspx?ID=N`). */
export interface FamiliarAbilityRef {
  /** Display text of the anchor (lower-cased ability name on AON). */
  name:        string;
  /** Numeric AON Familiars.aspx ID, when the link contains `?ID=`. */
  familiar_id: number | null;
}

/**
 * A sub-ability described by a `<h2 class="title">` block inside a Specific
 * Familiar page (e.g. "Haunting Melody", "Created Magic").
 */
export interface FamiliarSubAbility {
  /** Heading text, e.g. "Haunting Melody". */
  name:        string;
  /** Linked AON Familiars.aspx ID for the ability, when present. */
  familiar_id: number | null;
  /** Action cost glyph parsed from the heading, when present. */
  action_cost: ActionCost | null;
  /** Trait pills appearing immediately under the heading. */
  traits:      string[];
  /** `<b>Frequency</b>` value, when present. */
  frequency:   string | null;
  /** `<b>Effect</b>` value, when present. */
  effect:      string | null;
  /** `<b>Trigger</b>` value, when present. */
  trigger:     string | null;
  /** First `<b>Source</b>` reference inside this sub-section. */
  source:      SourceRef | null;
  /** Flattened prose body of the sub-section. */
  body_text:   string;
  /** Verbatim HTML of the sub-section body. */
  body_html:   string;
}

export interface FamiliarOutput {
  _type:                          'familiar';
  url:                            string;
  /** Numeric AON ID extracted from the URL (`?ID=N`). */
  familiar_id:                    number | null;
  name:                           string;
  /**
   * `specific` for a named creature page (`?Specific=true`); `ability` for a
   * single granted-ability page (default / `?Abilities=true`).
   */
  familiar_kind:                  'specific' | 'ability';
  /**
   * Raw `<b>Ability Type</b>` discriminator on ability pages:
   * `Familiar`, `Master`, or `Specific Familiar`. Null on specific-familiar
   * pages (their kind is encoded by `familiar_kind` + `granted_abilities`).
   */
  ability_type:                   'Familiar' | 'Master' | 'Specific Familiar' | null;
  /**
   * When the ability is restricted to a specific familiar (e.g. "Created
   * Magic" is restricted to the "Elemental Wisp" specific familiar), this
   * captures the parent familiar reference.
   */
  specific_familiar_parent:       FamiliarAbilityRef | null;
  rarity:                         Rarity;
  pfs:                            PfsLegality | null;
  legacy:                         boolean;
  alt_edition_url:                string | null;
  /** Title-line action glyph if the page itself carries one. */
  action_cost:                    ActionCost | null;
  traits:                         string[];
  trait_ids:                      Record<string, number>;
  source:                         { book: string | null; page: number | null; source_id: number | null };
  sources:                        SourceRef[];
  /** Specific Familiar: number of familiar/master abilities the creature counts as. */
  required_number_of_abilities:   number | null;
  /** Specific Familiar: pre-selected familiar abilities granted by the creature. */
  granted_abilities:              FamiliarAbilityRef[];
  /** Header `<b>Frequency</b>` field, when present. */
  frequency:                      string | null;
  /** Header `<b>Trigger</b>` field, when present. */
  trigger:                        string | null;
  /** Header `<b>Effect</b>` field, when present (rare; most abilities inline their effect). */
  effect:                         string | null;
  /** Sub-ability sections (Specific Familiar pages). */
  abilities:                      FamiliarSubAbility[];
  sections:                       Section[];
  raw_fields:                     Record<string, string>;
  links:                          LinkRef[];
  body_text:                      string;
  body_html:                      string;
  meta_description:               string | null;
  meta_keywords:                  string | null;
}

// ─── Per-node slice types ─────────────────────────────────────────────────

/** Fields owned by `extract-familiar-base`. */
export interface FamiliarBaseSlice {
  _type:           'familiar';
  url:             string;
  familiar_id:     number | null;
  name:            string;
  familiar_kind:   'specific' | 'ability';
  rarity:          Rarity;
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;
  action_cost:     ActionCost | null;
  traits:          string[];
  trait_ids:       Record<string, number>;
  source:          FamiliarOutput['source'];
  sources:         SourceRef[];
}

/** Fields owned by `extract-familiar-prerequisites`. */
export interface FamiliarPrerequisitesSlice {
  ability_type:                 FamiliarOutput['ability_type'];
  specific_familiar_parent:     FamiliarAbilityRef | null;
  required_number_of_abilities: number | null;
  granted_abilities:            FamiliarAbilityRef[];
  frequency:                    string | null;
  trigger:                      string | null;
  effect:                       string | null;
}

/** Fields owned by `extract-familiar-abilities`. */
export interface FamiliarAbilitiesSlice {
  abilities: FamiliarSubAbility[];
}

/** Fields owned by `extract-familiar-meta`. (sections/links/body/meta are attached by finalize.) */
export interface FamiliarMetaSlice {
  /** Placeholder so the node has a write target distinct from the other slices. */
  _meta_marker: true;
}
