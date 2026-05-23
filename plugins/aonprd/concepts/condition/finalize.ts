import type { CheerioAPI } from 'cheerio';
import type { CommonExtraction, Section } from '../../common.js';
import { stripStructuredKeys, filterLegacySections } from '../../common.js';
import { baseFrom, setConceptOutput } from '../_helpers.js';
import type { ConditionOutput, ConditionBaseSlice, ConditionStagesSlice } from './types.js';

/** AON labels every condition-slice helper has lifted into structured fields. */
const CONDITION_CLAIMED_LABELS: ReadonlyArray<string> = [
  'Source',
];

/** Assemble the final ConditionOutput from per-slice results. */
export function finalizeCondition(
  c:      CommonExtraction,
  base:   ConditionBaseSlice,
  stages: ConditionStagesSlice,
  $:      CheerioAPI,
): ConditionOutput {
  const baseShape = baseFrom(c, $);
  return {
    _type:              'condition',
    ...baseShape,
    url:                base.url,
    condition_id:       base.condition_id,
    name:               base.name,
    rarity:             base.rarity,
    pfs:                base.pfs,
    legacy:             base.legacy,
    alt_edition_url:    base.alt_edition_url,
    traits:             base.traits,
    trait_ids:          base.trait_ids,
    source:             base.source,
    sources:            base.sources,
    raw_fields:         stripStructuredKeys(c.field_map, CONDITION_CLAIMED_LABELS),
    stages:             stages.stages,
    related_conditions: stages.related_conditions,
  } satisfies ConditionOutput;
}

export function finalizeConditionWithSections(
  c:        CommonExtraction,
  base:     ConditionBaseSlice,
  stages:   ConditionStagesSlice,
  sections: Section[],
  $:        CheerioAPI,
): ConditionOutput {
  const output = finalizeCondition(c, base, stages, $);
  return {
    ...output,
    sections: filterLegacySections(sections),
    raw_fields: stripStructuredKeys(c.field_map, CONDITION_CLAIMED_LABELS),
  };
}
