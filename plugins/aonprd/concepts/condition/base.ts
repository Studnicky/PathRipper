import type { CommonExtraction } from '../../common.js';
import { extractEntityId } from '../../common.js';
import type { ConditionBaseSlice } from './types.js';

/** Extract identity + header scalars for a condition page. */
export function extractConditionBase(common: CommonExtraction): ConditionBaseSlice {
  return {
    url:             common.url,
    condition_id:    extractEntityId(common.url),
    name:            common.title.name,
    rarity:          common.traits.rarity,
    pfs:             common.title.pfs,
    legacy:          common.title.legacy,
    alt_edition_url: common.title.alt_edition_url,
    traits:          common.traits.traits,
    trait_ids:       common.traits.trait_ids,
    source:          { book: common.source.book, page: common.source.page, source_id: common.source.source_id },
    sources:         common.sources,
    level:           common.title.level,
  };
}
