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
export function extractArmorMechanics(c: CommonExtraction): ArmorMechanicsSlice {
  const groupHtml = getFieldHtml(c, 'Group');
  const group = readGroupAnchor(groupHtml, /ArmorGroups\.aspx/i);

  const categoryRaw = getField(c, 'Category');
  const category: ArmorOutput['category'] = categoryRaw !== null
    ? CATEGORY_ARMOR.get(categoryRaw.toLowerCase().trim()) ?? null
    : null;

  return {
    price:         parsePrice(getField(c, 'Price')),
    ac_bonus:      asInt(dashToNull(getField(c, 'AC Bonus'))),
    dex_cap:       asInt(dashToNull(getField(c, 'Dex Cap'))),
    check_penalty: asInt(dashToNull(getField(c, 'Check Penalty'))),
    speed_penalty: asInt(dashToNull(getField(c, 'Speed Penalty'))),
    strength:      asInt(dashToNull(getField(c, 'Strength'))),
    bulk:          parseBulk(getField(c, 'Bulk')),
    category,
    group,
  };
}
