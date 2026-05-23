// Animal-companion base extraction node.
import type { CheerioAPI } from 'cheerio';
import type {
  CommonExtraction,
  CheerioNode,
} from '../../common.js';
import {
  extractEntityId,
  htmlToText,
} from '../../common.js';
import type { AnimalCompanionBaseSlice } from './types.js';
import { detectVariant, findField, harvestBoldEntries, parseBaseCompanion } from './helpers.js';

/**
 * Read the leading flavor sentence between the Source `<br/>` and the first
 * `<b>Size</b>` label by walking the content span HTML. Returns null when no
 * prose precedes the statblock (Unique / Specialized / Advancement pages don't
 * have a flavor line before their structured labels).
 */
function parseDescription(target: CheerioNode): string | null {
  const html = target.html() ?? '';
  // Locate the `<br/>` that follows the first Source line.
  const sourceMatch = /<b>\s*Source\s*<\/b>[\s\S]*?<br\s*\/?>/i.exec(html);
  if (sourceMatch === null) return null;
  const afterSource = html.slice(sourceMatch.index + sourceMatch[0].length);
  // Cut at the first <b>Size</b> label OR the first <hr/> (whichever comes first).
  const sizeCut = /<b>\s*Size\s*<\/b>/i.exec(afterSource);
  const hrCut   = /<hr\s*\/?>/i.exec(afterSource);
  let end = afterSource.length;
  if (sizeCut !== null) end = Math.min(end, sizeCut.index);
  if (hrCut !== null)   end = Math.min(end, hrCut.index);
  const text = htmlToText(afterSource.slice(0, end));
  return text === '' ? null : text;
}

/** Extract base identity + variant + base-companion reference + flavor text. */
export function extractAnimalCompanionBase(c: CommonExtraction, target: CheerioNode): AnimalCompanionBaseSlice {
  const variant = detectVariant(c.url);
  // Base companion reference lives in `c.fields` for statblock pages; on
  // Unique pages without `<hr/>` it ends up in body_html instead.
  let baseRef = null;
  const baseField = findField(c.fields, 'Base Animal Companion');
  if (baseField !== null) {
    baseRef = parseBaseCompanion(baseField.value_html);
  } else {
    const bodyEntries = harvestBoldEntries(c.body_html);
    for (const e of bodyEntries) {
      if (e.label.toLowerCase() === 'base animal companion') {
        baseRef = parseBaseCompanion(e.value_html);
        break;
      }
    }
  }
  return {
    _type:           'animal-companion',
    url:             c.url,
    companion_id:    extractEntityId(c.url),
    variant,
    name:            c.title.name,
    rarity:          c.traits.rarity,
    pfs:             c.title.pfs,
    legacy:          c.title.legacy,
    alt_edition_url: c.title.alt_edition_url,
    traits:          c.traits.traits,
    trait_ids:       c.traits.trait_ids,
    source:          { book: c.source.book, page: c.source.page, source_id: c.source.source_id },
    sources:         c.sources,
    base_companion:  baseRef,
    description:     variant === 'base' ? parseDescription(target) : null,
  };
}
