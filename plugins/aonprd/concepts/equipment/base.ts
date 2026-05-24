/**
 * Equipment concept — base slice extraction (weapon + armor base).
 *
 * Exports: extractWeaponBase, extractArmorBase, extractEquipmentBase.
 */
import type { CommonExtraction } from '../../common.js';
import { extractEntityId } from '../../common.js';
import type {
  WeaponBaseSlice,
  ArmorBaseSlice,
  EquipmentBaseSlice,
} from './types.js';

/** Extract weapon base slice (identity, source, traits). */
export function extractWeaponBase(c: CommonExtraction): WeaponBaseSlice {
  return {
    url:             c.url,
    weapon_id:       extractEntityId(c.url),
    name:            c.title.name,
    rarity:          c.traits.rarity,
    pfs:             c.title.pfs,
    legacy:          c.title.legacy,
    alt_edition_url: c.title.alt_edition_url,
    traits:          c.traits.traits,
    trait_ids:       c.traits.trait_ids,
    source:          { book: c.source.book, page: c.source.page, source_id: c.source.source_id },
    sources:         c.sources,
  };
}

/** Extract armor base slice. */
export function extractArmorBase(c: CommonExtraction): ArmorBaseSlice {
  return {
    url:             c.url,
    armor_id:        extractEntityId(c.url),
    name:            c.title.name,
    rarity:          c.traits.rarity,
    pfs:             c.title.pfs,
    legacy:          c.title.legacy,
    alt_edition_url: c.title.alt_edition_url,
    traits:          c.traits.traits,
    trait_ids:       c.traits.trait_ids,
    source:          { book: c.source.book, page: c.source.page, source_id: c.source.source_id },
    sources:         c.sources,
  };
}

/** Extract equipment base slice. */
export function extractEquipmentBase(c: CommonExtraction): EquipmentBaseSlice {
  return {
    url:             c.url,
    equipment_id:    extractEntityId(c.url),
    name:            c.title.name,
    item_level:      c.title.level,
    tiered_variants: c.title.tiered,
    rarity:          c.traits.rarity,
    pfs:             c.title.pfs,
    legacy:          c.title.legacy,
    alt_edition_url: c.title.alt_edition_url,
    traits:          c.traits.traits,
    trait_ids:       c.traits.trait_ids,
    source:          { book: c.source.book, page: c.source.page, source_id: c.source.source_id },
    sources:         c.sources,
  };
}
