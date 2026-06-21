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
export function extractWeaponBase(common: CommonExtraction): WeaponBaseSlice {
  return {
    url:             common.url,
    weapon_id:       extractEntityId(common.url),
    name:            common.title.name,
    rarity:          common.traits.rarity,
    pfs:             common.title.pfs,
    legacy:          common.title.legacy,
    alt_edition_url: common.title.alt_edition_url,
    traits:          common.traits.traits,
    trait_ids:       common.traits.trait_ids,
    source:          { book: common.source.book, page: common.source.page, source_id: common.source.source_id },
    sources:         common.sources,
  };
}

/** Extract armor base slice. */
export function extractArmorBase(common: CommonExtraction): ArmorBaseSlice {
  return {
    url:             common.url,
    armor_id:        extractEntityId(common.url),
    name:            common.title.name,
    rarity:          common.traits.rarity,
    pfs:             common.title.pfs,
    legacy:          common.title.legacy,
    alt_edition_url: common.title.alt_edition_url,
    traits:          common.traits.traits,
    trait_ids:       common.traits.trait_ids,
    source:          { book: common.source.book, page: common.source.page, source_id: common.source.source_id },
    sources:         common.sources,
  };
}

/** Extract equipment base slice. */
export function extractEquipmentBase(common: CommonExtraction): EquipmentBaseSlice {
  return {
    url:             common.url,
    equipment_id:    extractEntityId(common.url),
    name:            common.title.name,
    item_level:      common.title.level,
    tiered_variants: common.title.tiered,
    rarity:          common.traits.rarity,
    pfs:             common.title.pfs,
    legacy:          common.title.legacy,
    alt_edition_url: common.title.alt_edition_url,
    traits:          common.traits.traits,
    trait_ids:       common.traits.trait_ids,
    source:          { book: common.source.book, page: common.source.page, source_id: common.source.source_id },
    sources:         common.sources,
  };
}
