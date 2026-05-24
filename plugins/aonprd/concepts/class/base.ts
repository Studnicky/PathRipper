// extract:class-base slice.

import type { CheerioAPI } from 'cheerio';
import type { CommonExtraction, CheerioNode } from '../../common.js';
import {
  getField,
  asInt,
  extractEntityId,
} from '../../common.js';
import {
  readInlineBoldLabel,
  extractInitialProficiencies,
} from './helpers.js';
import type { ClassBaseSlice } from './types.js';

export function extractClassBase(c: CommonExtraction, _$: CheerioAPI, _span: CheerioNode): ClassBaseSlice {
  void _$;
  void _span;
  const fullHtml = c.body_html;
  const hpRaw   = readInlineBoldLabel(fullHtml, 'Hit Points')    ?? getField(c, 'Hit Points');
  const keyAttr = readInlineBoldLabel(fullHtml, 'Key Attribute')
                ?? readInlineBoldLabel(fullHtml, 'Key Ability')
                ?? getField(c, 'Key Attribute', 'Key Ability');
  const hp_per_level = hpRaw !== null ? asInt(hpRaw) : null;
  const initial_proficiencies = extractInitialProficiencies(fullHtml);
  const class_dc = getField(c, 'Class DC');

  return {
    url:                   c.url,
    class_id:             extractEntityId(c.url),
    name:                  c.title.name,
    rarity:                c.traits.rarity,
    pfs:                   c.title.pfs,
    legacy:                c.title.legacy,
    alt_edition_url:       c.title.alt_edition_url,
    traits:                c.traits.traits,
    trait_ids:             c.traits.trait_ids,
    source:                { book: c.source.book, page: c.source.page, source_id: c.source.source_id },
    sources:               c.sources,
    key_attribute:         keyAttr,
    hit_points_text:       hpRaw,
    hp_per_level,
    initial_proficiencies,
    class_dc,
  };
}
