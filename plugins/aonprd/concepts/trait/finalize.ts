import type { CheerioAPI } from 'cheerio';
import type { CommonExtraction, Section } from '../../common.js';
import { stripStructuredKeys, filterLegacySections } from '../../common.js';
import { baseFrom, setConceptOutput } from '../_helpers.js';
import type { TraitOutput, TraitBaseSlice } from './types.js';
import { inferTraitCategory } from './helpers.js';

/** AON labels every trait-slice helper has lifted into structured fields. */
const TRAIT_CLAIMED_LABELS: ReadonlyArray<string> = [
  'Source',
];

/** Assemble the final TraitOutput from per-slice results. */
export function finalizeTrait(
  c:    CommonExtraction,
  base: TraitBaseSlice,
  $:    CheerioAPI,
): TraitOutput {
  const category = inferTraitCategory(c);
  const baseShape = baseFrom(c, $);
  return {
    ...baseShape,
    url:             base.url,
    trait_id:        base.trait_id,
    name:            base.name,
    rarity:          base.rarity,
    pfs:             base.pfs,
    legacy:          base.legacy,
    alt_edition_url: base.alt_edition_url,
    traits:          base.traits,
    trait_ids:       base.trait_ids,
    source:          base.source,
    sources:         base.sources,
    raw_fields:      stripStructuredKeys(c.field_map, TRAIT_CLAIMED_LABELS),
    category,
  } satisfies TraitOutput;
}

export function finalizeTraitWithSections(
  c:        CommonExtraction,
  base:     TraitBaseSlice,
  sections: Section[],
  $:        CheerioAPI,
): TraitOutput {
  const output = finalizeTrait(c, base, $);
  return {
    ...output,
    sections:  filterLegacySections(sections),
    raw_fields: stripStructuredKeys(c.field_map, TRAIT_CLAIMED_LABELS),
  };
}
