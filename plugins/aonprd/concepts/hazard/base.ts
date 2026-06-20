import type { CommonExtraction } from '../../common.js';
import { getField, extractEntityId } from '../../common.js';
import type { HazardBaseSlice } from './types.js';
import { parseStealth, getHazardField } from './helpers.js';

/** Extract identity + header scalars for a hazard page. */
export function extractHazardBase(common: CommonExtraction): HazardBaseSlice {
  const compRaw = (getField(common, 'Complexity') ?? '').toLowerCase();
  const complexity: 'simple' | 'complex' | null =
    compRaw === 'simple'  ? 'simple' :
    compRaw === 'complex' ? 'complex' : null;
  return {
    url:             common.url,
    hazard_id:       extractEntityId(common.url),
    name:            common.title.name,
    level:           common.title.level,
    rarity:          common.traits.rarity,
    pfs:             common.title.pfs,
    legacy:          common.title.legacy,
    alt_edition_url: common.title.alt_edition_url,
    traits:          common.traits.traits,
    trait_ids:       common.traits.trait_ids,
    source:          { book: common.source.book, page: common.source.page, source_id: common.source.source_id },
    sources:         common.sources,
    complexity,
    stealth:         parseStealth(getHazardField(common, 'Stealth') ?? getField(common, 'Perception')),
    description_text: getField(common, 'Description'),
  };
}
