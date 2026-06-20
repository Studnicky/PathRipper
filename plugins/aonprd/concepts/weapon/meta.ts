/**
 * Weapon meta extraction — favored_weapon, crit spec, magic weapons, glossary, access.
 */
import type { CheerioAPI } from 'cheerio';
import type { CommonExtraction, CheerioNode } from '../../common.js';
import { getField, getFieldHtml } from '../../common.js';
import type { WeaponMetaSlice } from './types.js';
import {
  buildDescription,
  dashToNull,
  parseCriticalSpec,
  parseFavoredWeapon,
  parseSpecificMagicWeapons,
  parseTraitGlossary,
} from './helpers.js';

/** Extract weapon meta slice (favored_weapon, crit spec, magic weapons, glossary, access). */
export function extractWeaponMeta(
  common: CommonExtraction,
  root:   CheerioAPI,
  span:   CheerioNode,
): WeaponMetaSlice {
  const description = buildDescription(common.body_html);
  return {
    favored_weapon:          parseFavoredWeapon(getFieldHtml(common, 'Favored Weapon')),
    critical_specialization: parseCriticalSpec(common),
    specific_magic_weapons:  parseSpecificMagicWeapons(common),
    trait_glossary:          parseTraitGlossary(root, span),
    access:                  dashToNull(getField(common, 'Access')),
    description_html:        description.html,
    description_text:        description.text,
  };
}
