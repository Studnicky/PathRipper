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
  const t = raw.trim();
  if (t === '1') return '1';
  if (t === '2') return '2';
  if (t === '1+' || /^1\s*\+/.test(t)) return '1+';
  return null;
}

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
