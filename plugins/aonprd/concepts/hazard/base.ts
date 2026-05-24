import type { CommonExtraction } from '../../common.js';
import { getField, extractEntityId } from '../../common.js';
import type { HazardBaseSlice } from './types.js';
import { parseStealth, getHazardField } from './helpers.js';

/** Extract identity + header scalars for a hazard page. */
export function extractHazardBase(c: CommonExtraction): HazardBaseSlice {
  const compRaw = (getField(c, 'Complexity') ?? '').toLowerCase();
  const complexity: 'simple' | 'complex' | null =
    compRaw === 'simple'  ? 'simple' :
    compRaw === 'complex' ? 'complex' : null;
  return {
    url:             c.url,
    hazard_id:       extractEntityId(c.url),
    name:            c.title.name,
    level:           c.title.level,
    rarity:          c.traits.rarity,
    pfs:             c.title.pfs,
    legacy:          c.title.legacy,
    alt_edition_url: c.title.alt_edition_url,
    traits:          c.traits.traits,
    trait_ids:       c.traits.trait_ids,
    source:          { book: c.source.book, page: c.source.page, source_id: c.source.source_id },
    sources:         c.sources,
    complexity,
    stealth:         parseStealth(getHazardField(c, 'Stealth') ?? getField(c, 'Perception')),
    description_text: getField(c, 'Description'),
  };
}
