/**
 * Equipment concept — shared type declarations.
 *
 * Exports: WeaponOutput, ArmorOutput, EquipmentVariant, Activation,
 * EquipmentOutput, and all per-slice type interfaces.
 */
import type { ActionCost, LinkRef, Rarity, PfsLegality, SourceRef } from '../../common.js';
import type { ConceptOutputBase } from '../../taxonomy.js';

// ─── Output types ─────────────────────────────────────────────────────────────

export interface WeaponOutputFields {
  url: string;
  /** Numeric AON ID extracted from the URL query string. */
  weapon_id: number | null;
  name: string;
  rarity: Rarity;
  pfs: PfsLegality | null;
  legacy: boolean;
  alt_edition_url: string | null;
  traits: string[];
  /** Trait AON IDs keyed by trait name. */
  trait_ids: Record<string, number>;
  source: { book: string | null; page: number | null; source_id: number | null };
  /** All source refs on the page (header + body footnotes). */
  sources: SourceRef[];
  favored_weapon: Array<{ deity: string; deity_id: number | null }>;
  price: { gp: number | null; sp: number | null; cp: number | null; raw: string | null };
  damage: { dice: string; type: 'B' | 'P' | 'S' | null; rider: string | null } | null;
  bulk: 'L' | number | null;
  hands: '1' | '2' | '1+' | null;
  reload: string | null;
  range: { feet: number } | null;
  ammunition: string | null;
  weapon_type: 'melee' | 'ranged' | null;
  category: 'unarmed' | 'simple' | 'martial' | 'advanced' | null;
  group: { name: string; group_id: number | null } | null;
  /**
   * Free-form `Access` requirement (e.g. "You are a member of the Hellknights")
   * lifted from the `<b>Access</b>` field.
   */
  access: string | null;
  description_html: string;
  description_text: string;
  critical_specialization: { source: string | null; by_group: Record<string, string> } | null;
  specific_magic_weapons: Array<{ name: string; equipment_id: number | null }>;
  trait_glossary: Array<{ trait: string; description: string }>;
  raw_fields: Record<string, string>;
  links: LinkRef[];
  /** `<meta name="description">` content. */
  meta_description: string | null;
  /** `<meta name="keywords">` content. */
  meta_keywords: string | null;
}

/** Full output shape — `_type` discriminator stamped by the router at chain entry. */
export type WeaponOutput = ConceptOutputBase<'weapon'> & WeaponOutputFields;

export interface ArmorOutputFields {
  url: string;
  /** Numeric AON ID extracted from the URL query string. */
  armor_id: number | null;
  name: string;
  rarity: Rarity;
  pfs: PfsLegality | null;
  legacy: boolean;
  alt_edition_url: string | null;
  traits: string[];
  /** Trait AON IDs keyed by trait name. */
  trait_ids: Record<string, number>;
  source: { book: string | null; page: number | null; source_id: number | null };
  /** All source refs on the page (header + body footnotes). */
  sources: SourceRef[];
  price: { gp: number | null; sp: number | null; cp: number | null; raw: string | null };
  ac_bonus: number | null;
  dex_cap: number | null;
  check_penalty: number | null;
  speed_penalty: number | null;
  strength: number | null;
  bulk: 'L' | number | null;
  category: 'unarmored' | 'light' | 'medium' | 'heavy' | null;
  group: { name: string; group_id: number | null } | null;
  /**
   * Shield/armor hardness rating (e.g. shields use this for their Block reaction).
   * Em-dash → null.
   */
  hardness: number | null;
  /**
   * Shield "HP (BT)" — current HP value with the parenthesised Broken Threshold.
   * Stored as the leading integer (HP); when AON renders only the BT, the lone
   * integer is captured. Em-dash → null.
   */
  hp_bt: number | null;
  description_html: string;
  description_text: string;
  raw_fields: Record<string, string>;
  links: LinkRef[];
  /** `<meta name="description">` content. */
  meta_description: string | null;
  /** `<meta name="keywords">` content. */
  meta_keywords: string | null;
}

/** Full output shape — `_type` discriminator stamped by the router at chain entry. */
export type ArmorOutput = ConceptOutputBase<'armor'> & ArmorOutputFields;

export interface EquipmentVariant {
  name: string;
  item_level: number | null;
  source: { book: string | null; page: number | null; source_id: number | null };
  price: { gp: number | null; sp: number | null; cp: number | null; raw: string | null };
  bulk: 'L' | number | null;
  description_text: string;
}

export interface Activation {
  action_cost: ActionCost | null;
  components: string[];
  text: string | null;
}

export interface EquipmentOutputFields {
  url: string;
  /** Numeric AON ID extracted from the URL query string. */
  equipment_id: number | null;
  name: string;
  item_level: number | null;
  tiered_variants: boolean;
  rarity: Rarity;
  pfs: PfsLegality | null;
  legacy: boolean;
  alt_edition_url: string | null;
  traits: string[];
  /** Trait AON IDs keyed by trait name. */
  trait_ids: Record<string, number>;
  source: { book: string | null; page: number | null; source_id: number | null };
  /** All source refs on the page (header + body footnotes). */
  sources: SourceRef[];
  price: { gp: number | null; sp: number | null; cp: number | null; raw: string | null };
  bulk: 'L' | number | null;
  usage: string | null;
  hands: string | null;
  /**
   * Raw `Activate` field text (free-form activation summary as displayed by AON).
   * Populated even when `activations[]` is also captured; em-dash → null.
   */
  activate: string | null;
  activations: Activation[];
  frequency: string | null;
  trigger: string | null;
  requirements: string | null;
  effect: string | null;
  onset: string | null;
  duration: string | null;
  craft_requirements: string | null;
  access: string | null;
  benefit: string | null;
  drawback: string | null;
  cost: string | null;
  saving_throw: string | null;
  /**
   * Base armor type referenced by specific magic armor pages (e.g. "leather").
   * Lifted from `<b>Base Armor</b>`; em-dash → null.
   */
  base_armor: string | null;
  /**
   * Base weapon type referenced by specific magic weapon pages (e.g. "longsword").
   * Lifted from `<b>Base Weapon</b>`; em-dash → null.
   */
  base_weapon: string | null;
  description_html: string;
  description_text: string;
  variants: EquipmentVariant[];
  raw_fields: Record<string, string>;
  links: LinkRef[];
  /** `<meta name="description">` content. */
  meta_description: string | null;
  /** `<meta name="keywords">` content. */
  meta_keywords: string | null;
  /** PFS Note text harvested from the inline `<u><a href="PFS.aspx">…</a></u>` block, null when absent. Optional — populated by the finalize node when present, omitted otherwise. */
  pfs_note?: string | null;
}

/** Full output shape — `_type` discriminator stamped by the router at chain entry. */
export type EquipmentOutput = ConceptOutputBase<'equipment'> & EquipmentOutputFields;

// ─── Per-slice types ──────────────────────────────────────────────────────────

/** Fields owned by `extract-weapon-base`. */
export interface WeaponBaseSlice {
  url:             string;
  weapon_id:       number | null;
  name:            string;
  rarity:          Rarity;
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;
  traits:          string[];
  trait_ids:       Record<string, number>;
  source:          WeaponOutput['source'];
  sources:         SourceRef[];
}

/** Fields owned by `extract-weapon-mechanics`. */
export interface WeaponMechanicsSlice {
  price:       WeaponOutput['price'];
  damage:      WeaponOutput['damage'];
  bulk:        WeaponOutput['bulk'];
  hands:       WeaponOutput['hands'];
  reload:      string | null;
  range:       WeaponOutput['range'];
  ammunition:  string | null;
  weapon_type: WeaponOutput['weapon_type'];
  category:    WeaponOutput['category'];
  group:       WeaponOutput['group'];
}

/** Fields owned by `extract-weapon-meta`. */
export interface WeaponMetaSlice {
  favored_weapon:          WeaponOutput['favored_weapon'];
  critical_specialization: WeaponOutput['critical_specialization'];
  specific_magic_weapons:  WeaponOutput['specific_magic_weapons'];
  trait_glossary:          WeaponOutput['trait_glossary'];
  access:                  string | null;
  description_html:        string;
  description_text:        string;
}

/** Fields owned by `extract-armor-base`. */
export interface ArmorBaseSlice {
  url:             string;
  armor_id:        number | null;
  name:            string;
  rarity:          Rarity;
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;
  traits:          string[];
  trait_ids:       Record<string, number>;
  source:          ArmorOutput['source'];
  sources:         SourceRef[];
}

/** Fields owned by `extract-armor-mechanics`. */
export interface ArmorMechanicsSlice {
  price:         ArmorOutput['price'];
  ac_bonus:      number | null;
  dex_cap:       number | null;
  check_penalty: number | null;
  speed_penalty: number | null;
  strength:      number | null;
  bulk:          ArmorOutput['bulk'];
  category:      ArmorOutput['category'];
  group:         ArmorOutput['group'];
}

/** Fields owned by `extract-armor-meta`. */
export interface ArmorMetaSlice {
  hardness:         number | null;
  hp_bt:            number | null;
  description_html: string;
  description_text: string;
}

/** Fields owned by `extract-equipment-base`. */
export interface EquipmentBaseSlice {
  url:             string;
  equipment_id:    number | null;
  name:            string;
  item_level:      number | null;
  tiered_variants: boolean;
  rarity:          Rarity;
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;
  traits:          string[];
  trait_ids:       Record<string, number>;
  source:          EquipmentOutput['source'];
  sources:         SourceRef[];
}

/** Fields owned by `extract-equipment-mechanics`. */
export interface EquipmentMechanicsSlice {
  price:              EquipmentOutput['price'];
  bulk:               EquipmentOutput['bulk'];
  hands:              string | null;
  usage:              string | null;
  activate:           string | null;
  activations:        Activation[];
  frequency:          string | null;
  trigger:            string | null;
  requirements:       string | null;
  effect:             string | null;
  onset:              string | null;
  duration:           string | null;
  craft_requirements: string | null;
  access:             string | null;
  benefit:            string | null;
  drawback:           string | null;
  cost:               string | null;
  saving_throw:       string | null;
}

/** Fields owned by `extract-equipment-meta`. */
export interface EquipmentMetaSlice {
  base_armor:       string | null;
  base_weapon:      string | null;
  description_html: string;
  description_text: string;
  variants:         EquipmentVariant[];
}
