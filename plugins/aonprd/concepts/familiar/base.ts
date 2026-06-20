// Familiar base extraction node.
import type { CommonExtraction } from '../../common.js';
import { extractEntityId } from '../../common.js';
import type { FamiliarBaseSlice } from './types.js';
import { isSpecificUrl } from './helpers.js';

/** Extract base identity + header scalars for a familiar page. */
export function extractFamiliarBase(common: CommonExtraction): FamiliarBaseSlice {
  const familiar_kind: 'specific' | 'ability' = isSpecificUrl(common.url) ? 'specific' : 'ability';
  return {
    url:             common.url,
    familiar_id:     extractEntityId(common.url),
    name:            common.title.name,
    familiar_kind,
    rarity:          common.traits.rarity,
    pfs:             common.title.pfs,
    legacy:          common.title.legacy,
    alt_edition_url: common.title.alt_edition_url,
    action_cost:     common.title.action_cost,
    traits:          common.traits.traits,
    trait_ids:       common.traits.trait_ids,
    source:          { book: common.source.book, page: common.source.page, source_id: common.source.source_id },
    sources:         common.sources,
  };
}
