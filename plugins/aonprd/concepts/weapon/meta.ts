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
  c:    CommonExtraction,
  $:    CheerioAPI,
  span: CheerioNode,
): WeaponMetaSlice {
  const description = buildDescription(c.body_html);
  return {
    favored_weapon:          parseFavoredWeapon(getFieldHtml(c, 'Favored Weapon')),
    critical_specialization: parseCriticalSpec(c),
    specific_magic_weapons:  parseSpecificMagicWeapons(c),
    trait_glossary:          parseTraitGlossary($, span),
    access:                  dashToNull(getField(c, 'Access')),
    description_html:        description.html,
    description_text:        description.text,
  };
}
