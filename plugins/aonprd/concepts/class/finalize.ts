// finalize:class node.

import type { CheerioAPI } from 'cheerio';
import type { CommonExtraction, CheerioNode } from '../../common.js';
import {
  extractMetaDescription,
  extractMetaKeywords,
  stripStructuredKeys,
} from '../../common.js';
import type {
  ClassOutput,
  ClassBaseSlice,
  ClassProgressionSlice,
  ClassSubclassesSlice,
  ClassMetaSlice,
} from './types.js';

const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Source', 'Class Features', 'Hit Points', 'Key Attribute', 'Key Ability',
  'Initial Proficiencies', 'Class DC',
];

const NON_SUBCLASS_LABELS: ReadonlySet<string> = new Set<string>([
  'usage', 'bulk', 'activate', 'access', 'price', 'hands', 'category', 'group',
  'damage', 'range', 'reload', 'ammunition', 'duration', 'cost', 'cast',
  'requirements', 'trigger', 'effect', 'frequency', 'area', 'defense', 'target',
  'targets', 'saving throw', 'level', 'traditions', 'tradition', 'item', 'type',
  'archetype', 'prerequisites', 'related sources', 'related source',
  'spoiler warning',
  'cantrips',
  '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th',
  '1st-level spells', '2nd-level spells', '3rd-level spells', '4th-level spells',
  '5th-level spells', '6th-level spells', '7th-level spells', '8th-level spells',
  '9th-level spells', '10th-level spells',
  'alchemical item formulas', 'dragon empires zodiac', 'made of an element',
  'overlapping kinetic auras',
]);

export function finalizeClass(
  c:            CommonExtraction,
  base:         ClassBaseSlice,
  progression:  ClassProgressionSlice,
  subclasses:   ClassSubclassesSlice,
  meta:         ClassMetaSlice,
  $:            CheerioAPI,
): ClassOutput {
  const claimedSubclassLabels = subclasses.subclass_features.map((f) => f.name);
  const raw_fields = stripStructuredKeys(c.field_map, [
    ...CLAIMED_FIELD_LABELS,
    ...claimedSubclassLabels,
    ...NON_SUBCLASS_LABELS,
  ]);

  return {
    ...base,
    sections:         meta.sections,
    raw_fields,
    links:            c.links,
    body_text:        c.body_text,
    body_html:        c.body_html,
    meta_description: extractMetaDescription($),
    meta_keywords:    extractMetaKeywords($),
    subclasses:       subclasses.subclasses,
    progression:      progression.progression,
    subclass_features: subclasses.subclass_features,
  } satisfies ClassOutput;
}
