// Finalize armor output by assembling slices and projecting CommonExtraction.

import type { CheerioAPI } from 'cheerio';

import type { CommonExtraction } from '../../common.js';
import { stripStructuredKeys, extractMetaDescription, extractMetaKeywords } from '../../common.js';
import type { ArmorOutput, ArmorOutputFields, ArmorBaseSlice, ArmorMechanicsSlice, ArmorMetaSlice } from './types.js';
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
  c:         CommonExtraction,
  base:      ArmorBaseSlice,
  mechanics: ArmorMechanicsSlice,
  meta:      ArmorMetaSlice,
  $:         CheerioAPI,
): ArmorOutputFields {
  const raw_fields = stripStructuredKeys(c.field_map, ARMOR_CLAIMED_LABELS);
  return {
    ...base,
    ...mechanics,
    ...meta,
    raw_fields,
    links:            c.links,
    meta_description: extractMetaDescription($),
    meta_keywords:    extractMetaKeywords($),
  } satisfies ArmorOutputFields;
}

/** Project a CommonExtraction of an Armor.aspx page into a typed ArmorOutputFields. */
export function extractArmor(c: CommonExtraction, $: CheerioAPI): ArmorOutputFields {
  const base      = extractArmorBase(c);
  const mechanics = extractArmorMechanics(c);
  const meta      = extractArmorMeta(c);
  return finalizeArmor(c, base, mechanics, meta, $);
}
