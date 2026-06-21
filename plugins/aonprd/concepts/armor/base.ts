// Extract armor base slice (identity, source, traits).

import type { CommonExtraction } from '../../common.js';
import { extractEntityId } from '../../common.js';
import type { ArmorBaseSlice } from './types.js';

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
