/**
 * Equipment concept — mechanics slice extraction (weapon + armor + equipment).
 *
 * Exports: extractWeaponMechanics, extractArmorMechanics, extractEquipmentMechanics.
 */
import type { CommonExtraction } from '../../common.js';
import {
  getField,
  getFieldHtml,
  getAllFields,
  asInt,
} from '../../common.js';
import type {
  WeaponMechanicsSlice,
  ArmorMechanicsSlice,
  EquipmentMechanicsSlice,
  WeaponOutput,
  ArmorOutput,
} from './types.js';
import {
  parsePrice,
  parseBulk,
  parseDamage,
  parseRange,
  parseActivation,
  dashToNull,
  readGroupAnchor,
  parseWeaponHands,
} from './helpers.js';
import { htmlToText } from '../../common.js';

const CATEGORY_WEAPON: ReadonlyMap<string, 'unarmed' | 'simple' | 'martial' | 'advanced'> = new Map([
  ['unarmed', 'unarmed'],
  ['simple', 'simple'],
  ['martial', 'martial'],
  ['advanced', 'advanced'],
]);

const CATEGORY_ARMOR: ReadonlyMap<string, 'unarmored' | 'light' | 'medium' | 'heavy'> = new Map([
  ['unarmored', 'unarmored'],
  ['light',     'light'],
  ['medium',    'medium'],
  ['heavy',     'heavy'],
]);

/** Extract weapon mechanics slice (price/damage/bulk/hands/range/category/group). */
export function extractWeaponMechanics(c: CommonExtraction): WeaponMechanicsSlice {
  const groupHtml = getFieldHtml(c, 'Group');
  const group = readGroupAnchor(groupHtml, /WeaponGroups\.aspx/i);

  const typeRaw = getField(c, 'Type');
  let weapon_type: WeaponOutput['weapon_type'] = null;
  if (typeRaw !== null) {
    const lc = typeRaw.toLowerCase().trim();
    if (lc === 'melee') weapon_type = 'melee';
    else if (lc === 'ranged') weapon_type = 'ranged';
  }

  const categoryRaw = getField(c, 'Category');
  const category: WeaponOutput['category'] = categoryRaw !== null
    ? CATEGORY_WEAPON.get(categoryRaw.toLowerCase().trim()) ?? null
    : null;

  return {
    price:       parsePrice(getField(c, 'Price')),
    damage:      parseDamage(getField(c, 'Damage')),
    bulk:        parseBulk(getField(c, 'Bulk')),
    hands:       parseWeaponHands(getField(c, 'Hands')),
    reload:      dashToNull(getField(c, 'Reload')),
    range:       parseRange(getField(c, 'Range')),
    ammunition:  dashToNull(getField(c, 'Ammunition')),
    weapon_type,
    category,
    group,
  };
}

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

/** Extract equipment mechanics slice (price/bulk/usage/hands/activations/inline labels). */
export function extractEquipmentMechanics(c: CommonExtraction): EquipmentMechanicsSlice {
  // Activations: walk every Activate field (may repeat).
  const activateFields = getAllFields(c, 'Activate');
  const activations = activateFields.map((f) => parseActivation(f.value_html));

  // Inline body labels (Effect/Benefit/Drawback/etc. live inside body, not header).
  const bodyHtml = c.body_html;
  const grabInline = (label: string): string | null => {
    const re = new RegExp(`<b>\\s*${label}\\s*</b>([\\s\\S]*?)(?=<b>|<h2|<h3|$)`, 'i');
    const m = re.exec(bodyHtml);
    if (m === null) return null;
    const text = htmlToText(m[1] ?? '');
    return text === '' ? null : text;
  };

  return {
    price:              parsePrice(getField(c, 'Price')),
    bulk:               parseBulk(getField(c, 'Bulk')),
    usage:              dashToNull(getField(c, 'Usage')),
    hands:              dashToNull(getField(c, 'Hands')),
    activate:           dashToNull(getField(c, 'Activate')),
    activations,
    frequency:          dashToNull(getField(c, 'Frequency'))    ?? grabInline('Frequency'),
    trigger:            dashToNull(getField(c, 'Trigger'))      ?? grabInline('Trigger'),
    requirements:       dashToNull(getField(c, 'Requirements')) ?? grabInline('Requirements'),
    effect:             dashToNull(getField(c, 'Effect'))       ?? grabInline('Effect'),
    onset:              dashToNull(getField(c, 'Onset'))        ?? grabInline('Onset'),
    duration:           dashToNull(getField(c, 'Duration'))     ?? grabInline('Duration'),
    craft_requirements: dashToNull(getField(c, 'Craft Requirements')) ?? grabInline('Craft Requirements'),
    access:             dashToNull(getField(c, 'Access'))       ?? grabInline('Access'),
    benefit:            dashToNull(getField(c, 'Benefit'))      ?? grabInline('Benefit'),
    drawback:           dashToNull(getField(c, 'Drawback'))     ?? grabInline('Drawback'),
    cost:               dashToNull(getField(c, 'Cost'))         ?? grabInline('Cost'),
    saving_throw:       dashToNull(getField(c, 'Saving Throw')) ?? grabInline('Saving Throw'),
  };
}
