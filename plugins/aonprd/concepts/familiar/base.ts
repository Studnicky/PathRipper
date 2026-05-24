// Familiar base extraction node.
import type { CommonExtraction } from '../../common.js';
import { extractEntityId } from '../../common.js';
import type { FamiliarBaseSlice } from './types.js';
import { isSpecificUrl } from './helpers.js';

/** Extract base identity + header scalars for a familiar page. */
export function extractFamiliarBase(c: CommonExtraction): FamiliarBaseSlice {
  const familiar_kind: 'specific' | 'ability' = isSpecificUrl(c.url) ? 'specific' : 'ability';
  return {
    url:             c.url,
    familiar_id:     extractEntityId(c.url),
    name:            c.title.name,
    familiar_kind,
    rarity:          c.traits.rarity,
    pfs:             c.title.pfs,
    legacy:          c.title.legacy,
    alt_edition_url: c.title.alt_edition_url,
    action_cost:     c.title.action_cost,
    traits:          c.traits.traits,
    trait_ids:       c.traits.trait_ids,
    source:          { book: c.source.book, page: c.source.page, source_id: c.source.source_id },
    sources:         c.sources,
  };
}
