// Condition concept slices and extraction.

import type { CheerioAPI } from 'cheerio';
import type { CommonExtraction, CheerioNode } from '../../common.js';
import {
  extractEntityId,
  stripStructuredKeys,
} from '../../common.js';
import {
  baseFrom,
  type SourceShape,
} from '../_helpers.js';
import { parseConditionStages } from './helpers.js';
import type {
  ConditionOutput,
  ConditionBaseSlice,
  ConditionStagesSlice,
} from './types.js';

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

export function extractConditionStages(c: CommonExtraction): ConditionStagesSlice {
  const stages = parseConditionStages(c.body_html);
  const related_conditions = c.links
    .filter((l) => l.kind === 'Conditions')
    .map((l) => ({ name: l.text, condition_id: l.id }));
  return { stages, related_conditions };
}

const CONDITION_CLAIMED_LABELS: ReadonlyArray<string> = [
  'Source',
];

export function finalizeCondition(
  c:      CommonExtraction,
  base:   ConditionBaseSlice,
  stages: ConditionStagesSlice,
  $:      CheerioAPI,
): ConditionOutput {
  const baseShape = baseFrom(c, $);
  return {
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

export function extractCondition(c: CommonExtraction, $: CheerioAPI, _span: CheerioNode): ConditionOutput {
  void _span;
  const base   = extractConditionBase(c);
  const stages = extractConditionStages(c);
  return finalizeCondition(c, base, stages, $);
}
