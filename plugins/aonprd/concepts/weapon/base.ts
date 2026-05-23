/**
 * Weapon base extraction — identity, source, traits.
 */
import type { CommonExtraction } from '../../common.js';
import { extractEntityId } from '../../common.js';
import type { WeaponBaseSlice } from './types.js';

/** Extract weapon base slice (identity, source, traits). */
export function extractWeaponBase(c: CommonExtraction): WeaponBaseSlice {
  return {
    _type:           'weapon',
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
