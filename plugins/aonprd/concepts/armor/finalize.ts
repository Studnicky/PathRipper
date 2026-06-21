// Finalize armor output by assembling slices and projecting CommonExtraction.

import type { CheerioAPI } from 'cheerio';

import type { CommonExtraction } from '../../common.js';
import { stripStructuredKeys, extractMetaDescription, extractMetaKeywords } from '../../common.js';
import type { ArmorOutput, ArmorBaseSlice, ArmorMechanicsSlice, ArmorMetaSlice } from './types.js';
import { extractArmorBase } from './base.js';
import { extractArmorMechanics } from './mechanics.js';
import { extractArmorMeta } from './meta.js';

/** AON header labels claimed by the armor slices (stripped from raw_fields). */
const ARMOR_CLAIMED_LABELS: ReadonlyArray<string> = [
  'Source',
  'Price', 'AC Bonus', 'Dex Cap', 'Check Penalty', 'Speed Penalty', 'Strength',
  'Bulk', 'Category', 'Group',
  'Hardness', 'HP (BT)', 'HP', 'BT',
];

/** Assemble an ArmorOutput from per-slice results, stripping claimed labels from raw_fields. */
export function finalizeArmor(
  common:    CommonExtraction,
  base:      ArmorBaseSlice,
  mechanics: ArmorMechanicsSlice,
  meta:      ArmorMetaSlice,
  root:      CheerioAPI,
): ArmorOutput {
  const raw_fields = stripStructuredKeys(common.field_map, ARMOR_CLAIMED_LABELS);
  return {
    ...base,
    ...mechanics,
    ...meta,
    raw_fields,
    links:            common.links,
    meta_description: extractMetaDescription(root),
    meta_keywords:    extractMetaKeywords(root),
  } satisfies ArmorOutput;
}

/** Project a CommonExtraction of an Armor.aspx page into a typed ArmorOutput. */
export function extractArmor(common: CommonExtraction, root: CheerioAPI): ArmorOutput {
  const base      = extractArmorBase(common);
  const mechanics = extractArmorMechanics(common);
  const meta      = extractArmorMeta(common);
  return finalizeArmor(common, base, mechanics, meta, root);
}
