// Condition concept slices and extraction.

import type { CheerioAPI } from 'cheerio';
import type { CommonExtraction, CheerioNode } from '../../common.js';
import {
  extractEntityId,
  stripStructuredKeys,
} from '../../common.js';
import {
  baseFrom,
} from '../_helpers.js';
import { parseConditionStages } from './helpers.js';
import type {
  ConditionOutput,
  ConditionBaseSlice,
  ConditionStagesSlice,
} from './types.js';

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

export function extractConditionStages(common: CommonExtraction): ConditionStagesSlice {
  const stages = parseConditionStages(common.body_html);
  const related_conditions = common.links
    .filter((link) => link.kind === 'Conditions')
    .map((link) => ({ name: link.text, condition_id: link.id }));
  return { stages, related_conditions };
}

const CONDITION_CLAIMED_LABELS: ReadonlyArray<string> = [
  'Source',
];

export function finalizeCondition(
  common: CommonExtraction,
  base:   ConditionBaseSlice,
  stages: ConditionStagesSlice,
  root:   CheerioAPI,
): ConditionOutput {
  const baseShape = baseFrom(common, root);
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
    raw_fields:         stripStructuredKeys(common.field_map, CONDITION_CLAIMED_LABELS),
    stages:             stages.stages,
    related_conditions: stages.related_conditions,
  } satisfies ConditionOutput;
}

export function extractCondition(common: CommonExtraction, root: CheerioAPI, _span: CheerioNode): ConditionOutput {
  void _span;
  const base   = extractConditionBase(common);
  const stages = extractConditionStages(common);
  return finalizeCondition(common, base, stages, root);
}
