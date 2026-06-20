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
export function extractWeaponMechanics(common: CommonExtraction): WeaponMechanicsSlice {
  const groupHtml = getFieldHtml(common, 'Group');
  const group = readGroupAnchor(groupHtml, /WeaponGroups\.aspx/i);

  const typeRaw = getField(common, 'Type');
  let weapon_type: WeaponOutput['weapon_type'] = null;
  if (typeRaw !== null) {
    const lastChunk = typeRaw.toLowerCase().trim();
    if (lastChunk === 'melee') weapon_type = 'melee';
    else if (lastChunk === 'ranged') weapon_type = 'ranged';
  }

  const categoryRaw = getField(common, 'Category');
  const category: WeaponOutput['category'] = categoryRaw !== null
    ? CATEGORY_WEAPON.get(categoryRaw.toLowerCase().trim()) ?? null
    : null;

  return {
    price:       parsePrice(getField(common, 'Price')),
    damage:      parseDamage(getField(common, 'Damage')),
    bulk:        parseBulk(getField(common, 'Bulk')),
    hands:       parseWeaponHands(getField(common, 'Hands')),
    reload:      dashToNull(getField(common, 'Reload')),
    range:       parseRange(getField(common, 'Range')),
    ammunition:  dashToNull(getField(common, 'Ammunition')),
    weapon_type,
    category,
    group,
  };
}

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

/** Extract equipment mechanics slice (price/bulk/usage/hands/activations/inline labels). */
export function extractEquipmentMechanics(common: CommonExtraction): EquipmentMechanicsSlice {
  // Activations: walk every Activate field (may repeat).
  const activateFields = getAllFields(common, 'Activate');
  const activations = activateFields.map((field) => parseActivation(field.value_html));

  // Inline body labels (Effect/Benefit/Drawback/etc. live inside body, not header).
  const bodyHtml = common.body_html;
  const grabInline = (label: string): string | null => {
    const regex = new RegExp(`<b>\\s*${label}\\s*</b>([\\s\\S]*?)(?=<b>|<h2|<h3|$)`, 'i');
    const match = regex.exec(bodyHtml);
    if (match === null) return null;
    const text = htmlToText(match[1] ?? '');
    return text === '' ? null : text;
  };

  return {
    price:              parsePrice(getField(common, 'Price')),
    bulk:               parseBulk(getField(common, 'Bulk')),
    usage:              dashToNull(getField(common, 'Usage')),
    hands:              dashToNull(getField(common, 'Hands')),
    activate:           dashToNull(getField(common, 'Activate')),
    activations,
    frequency:          dashToNull(getField(common, 'Frequency'))    ?? grabInline('Frequency'),
    trigger:            dashToNull(getField(common, 'Trigger'))      ?? grabInline('Trigger'),
    requirements:       dashToNull(getField(common, 'Requirements')) ?? grabInline('Requirements'),
    effect:             dashToNull(getField(common, 'Effect'))       ?? grabInline('Effect'),
    onset:              dashToNull(getField(common, 'Onset'))        ?? grabInline('Onset'),
    duration:           dashToNull(getField(common, 'Duration'))     ?? grabInline('Duration'),
    craft_requirements: dashToNull(getField(common, 'Craft Requirements')) ?? grabInline('Craft Requirements'),
    access:             dashToNull(getField(common, 'Access'))       ?? grabInline('Access'),
    benefit:            dashToNull(getField(common, 'Benefit'))      ?? grabInline('Benefit'),
    drawback:           dashToNull(getField(common, 'Drawback'))     ?? grabInline('Drawback'),
    cost:               dashToNull(getField(common, 'Cost'))         ?? grabInline('Cost'),
    saving_throw:       dashToNull(getField(common, 'Saving Throw')) ?? grabInline('Saving Throw'),
  };
}
