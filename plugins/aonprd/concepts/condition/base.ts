import type { CommonExtraction } from '../../common.js';
import { extractEntityId } from '../../common.js';
import type { ConditionBaseSlice } from './types.js';

/** Extract identity + header scalars for a condition page. */
export function extractConditionBase(c: CommonExtraction): ConditionBaseSlice {
  return {
    url:             c.url,
    condition_id:    extractEntityId(c.url),
    name:            c.title.name,
    rarity:          c.traits.rarity,
    pfs:             c.title.pfs,
    legacy:          c.title.legacy,
    alt_edition_url: c.title.alt_edition_url,
    traits:          c.traits.traits,
    trait_ids:       c.traits.trait_ids,
    source:          { book: c.source.book, page: c.source.page, source_id: c.source.source_id },
    sources:         c.sources,
    level:           c.title.level,
  };
}
