/**
 * Weapon mechanics extraction — price, damage, bulk, hands, range, category, group.
 */
import type { CommonExtraction } from '../../common.js';
import { getField, getFieldHtml } from '../../common.js';
import type { WeaponMechanicsSlice, WeaponOutput } from './types.js';
import { dashToNull, parseBulk, parseDamage, parsePrice, parseRange, readGroupAnchor } from './helpers.js';

const CATEGORY_WEAPON: ReadonlyMap<string, 'unarmed' | 'simple' | 'martial' | 'advanced'> = new Map([
  ['unarmed', 'unarmed'],
  ['simple', 'simple'],
  ['martial', 'martial'],
  ['advanced', 'advanced'],
]);

function parseWeaponHands(raw: string | null): '1' | '2' | '1+' | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === '1') return '1';
  if (trimmed === '2') return '2';
  if (trimmed === '1+' || /^1\s*\+/.test(trimmed)) return '1+';
  return null;
}

/** Extract weapon mechanics slice (price/damage/bulk/hands/range/category/group). */
export function extractWeaponMechanics(common: CommonExtraction): WeaponMechanicsSlice {
  const groupHtml = getFieldHtml(common, 'Group');
  const group = readGroupAnchor(groupHtml, /WeaponGroups\.aspx/i);

  const typeRaw = getField(common, 'Type');
  let weapon_type: WeaponOutput['weapon_type'] = null;
  if (typeRaw !== null) {
    const lcType = typeRaw.toLowerCase().trim();
    if (lcType === 'melee') weapon_type = 'melee';
    else if (lcType === 'ranged') weapon_type = 'ranged';
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
