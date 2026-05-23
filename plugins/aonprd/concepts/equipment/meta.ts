/**
 * Equipment concept — meta slice extraction (weapon + armor + equipment).
 *
 * Exports: extractWeaponMeta, extractArmorMeta, extractEquipmentMeta.
 */
import type { CheerioAPI } from 'cheerio';
import type { CommonExtraction, CheerioNode } from '../../common.js';
import {
  getField,
  getFieldHtml,
  asInt,
} from '../../common.js';
import type {
  WeaponMetaSlice,
  ArmorMetaSlice,
  EquipmentMetaSlice,
  EquipmentVariant,
} from './types.js';
import {
  parseTraitGlossary,
  buildDescription,
  parseFavoredWeapon,
  parseCriticalSpec,
  parseSpecificMagicWeapons,
  dashToNull,
  parsePrice,
  parseBulk,
} from './helpers.js';
import { htmlToText } from '../../common.js';

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

/** Extract armor meta slice (hardness, hp_bt, description). */
export function extractArmorMeta(c: CommonExtraction): ArmorMetaSlice {
  const description = buildDescription(c.body_html);
  return {
    hardness:         asInt(dashToNull(getField(c, 'Hardness'))),
    hp_bt:            asInt(dashToNull(getField(c, 'HP (BT)', 'HP'))),
    description_html: description.html,
    description_text: description.text,
  };
}

/** Extract equipment meta slice (base_armor/base_weapon, description, variants). */
export function extractEquipmentMeta(c: CommonExtraction): EquipmentMetaSlice {
  const description = buildEquipmentDescription(c.body_html);
  return {
    base_armor:       dashToNull(getField(c, 'Base Armor')),
    base_weapon:      dashToNull(getField(c, 'Base Weapon')),
    description_html: description.html,
    description_text: description.text,
    variants:         parseVariants(c),
  };
}

const VARIANT_HEADING_RE = /\((Lesser|Moderate|Greater|Major)\)/i;

/** Walk variant `<h2 class="title">Name (Lesser/…)</h2>` blocks within the body. */
function parseVariants(c: CommonExtraction): EquipmentVariant[] {
  const out: EquipmentVariant[] = [];
  for (const section of c.sections) {
    if (!VARIANT_HEADING_RE.test(section.heading)) continue;
    // Extract item-level marker (`Item N`) from the heading text.
    const lvlMatch = /Item\s+(-?\d+)/i.exec(section.heading);
    const item_level = lvlMatch !== null ? parseInt(lvlMatch[1]!, 10) : null;
    const cleanName = section.heading.replace(/Item\s+-?\d+\+?/i, '').trim();

    // Harvest header-style fields out of the body HTML for this variant.
    const html = section.body_html;
    const sourceMatch = /<b>\s*Source\s*<\/b>\s*<a[^>]*href="[^"]*Sources\.aspx\?ID=(\d+)"[^>]*>\s*<i>([^<]+)<\/i>\s*<\/a>/i.exec(html);
    let source_id: number | null = null;
    let book: string | null = null;
    let page: number | null = null;
    if (sourceMatch !== null) {
      source_id = parseInt(sourceMatch[1]!, 10);
      const raw = sourceMatch[2] ?? '';
      const pgMatch = /^(.*?)\s*pg\.\s*(\d+)/i.exec(raw);
      if (pgMatch !== null) {
        book = (pgMatch[1] ?? '').trim();
        const n = parseInt(pgMatch[2]!, 10);
        page = Number.isFinite(n) ? n : null;
      } else {
        book = raw.trim();
      }
    }

    const priceMatch = /<b>\s*Price\s*<\/b>\s*([^<]+?)(?=<br|<b|$)/i.exec(html);
    const priceRaw = priceMatch !== null ? htmlToText(priceMatch[1] ?? '') : null;

    const bulkMatch = /<b>\s*Bulk\s*<\/b>\s*([^<]+?)(?=<br|<b|$)/i.exec(html);
    const bulkRaw = bulkMatch !== null ? htmlToText(bulkMatch[1] ?? '') : null;

    // Description = body HTML with leading label lines stripped.
    const stripped = html.replace(/<b>\s*(?:Source|Price|Bulk)\s*<\/b>[\s\S]*?<br\s*\/?>/gi, '');
    const description_text = htmlToText(stripped);

    out.push({
      name: cleanName,
      item_level,
      source: { book, page, source_id },
      price: parsePrice(priceRaw),
      bulk: parseBulk(bulkRaw),
      description_text,
    });
  }
  return out;
}

/** Build the prose description for equipment, dropping inline label paragraphs. */
function buildEquipmentDescription(bodyHtml: string): { html: string; text: string } {
  const subIdx = /<h2\s+class="title"/i.exec(bodyHtml);
  const before = subIdx === null ? bodyHtml : bodyHtml.slice(0, subIdx.index);
  // Strip inline `<b>Label</b> …` paragraphs that we already projected.
  const INLINE_LABELS = /(?:Frequency|Trigger|Requirements|Effect|Onset|Duration|Craft Requirements|Access|Benefit|Drawback|Cost|Saving Throw|Activate|Usage|Hands)/i;
  const stripped = before.replace(
    new RegExp(`<b>\\s*${INLINE_LABELS.source}\\s*</b>[\\s\\S]*?(?=<b>|<h2|<h3|<br\\s*/?>\\s*<br|$)`, 'gi'),
    '',
  );
  return { html: stripped.trim(), text: htmlToText(stripped) };
}
