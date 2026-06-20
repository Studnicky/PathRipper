// Extract armor mechanics slice (price/ac_bonus/penalties/bulk/category/group).

import type { CommonExtraction } from '../../common.js';
import { getField, getFieldHtml, asInt } from '../../common.js';
import type { ArmorMechanicsSlice, ArmorOutput } from './types.js';
import { dashToNull, parsePrice, parseBulk, readGroupAnchor } from './helpers.js';

const CATEGORY_ARMOR: ReadonlyMap<string, 'unarmored' | 'light' | 'medium' | 'heavy'> = new Map([
  ['unarmored', 'unarmored'],
  ['light',     'light'],
  ['medium',    'medium'],
  ['heavy',     'heavy'],
]);

/** Extract armor mechanics slice. */
export function extractArmorMechanics(common: CommonExtraction): ArmorMechanicsSlice {
  const groupHtml = getFieldHtml(common, 'Group');
  const group = readGroupAnchor(groupHtml, /ArmorGroups\.aspx/i);

  const categoryRaw = getField(common, 'Category');
  const category: ArmorOutput['category'] = categoryRaw !== null
    ? CATEGORY_ARMOR.get(categoryRaw.toLowerCase().trim()) ?? null
    : null;

  return {
    price:         parsePrice(getField(common, 'Price')),
    ac_bonus:      asInt(dashToNull(getField(common, 'AC Bonus'))),
    dex_cap:       asInt(dashToNull(getField(common, 'Dex Cap'))),
    check_penalty: asInt(dashToNull(getField(common, 'Check Penalty'))),
    speed_penalty: asInt(dashToNull(getField(common, 'Speed Penalty'))),
    strength:      asInt(dashToNull(getField(common, 'Strength'))),
    bulk:          parseBulk(getField(common, 'Bulk')),
    category,
    group,
  };
}
