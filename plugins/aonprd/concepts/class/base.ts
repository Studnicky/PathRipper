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

export function extractClassBase(common: CommonExtraction, _root: CheerioAPI, _span: CheerioNode): ClassBaseSlice {
  void _root;
  void _span;
  const fullHtml = common.body_html;
  const hpRaw   = readInlineBoldLabel(fullHtml, 'Hit Points')    ?? getField(common, 'Hit Points');
  const keyAttr = readInlineBoldLabel(fullHtml, 'Key Attribute')
                ?? readInlineBoldLabel(fullHtml, 'Key Ability')
                ?? getField(common, 'Key Attribute', 'Key Ability');
  const hp_per_level = hpRaw !== null ? asInt(hpRaw) : null;
  const initial_proficiencies = extractInitialProficiencies(fullHtml);
  const class_dc = getField(common, 'Class DC');

  return {
    url:                   common.url,
    class_id:             extractEntityId(common.url),
    name:                  common.title.name,
    rarity:                common.traits.rarity,
    pfs:                   common.title.pfs,
    legacy:                common.title.legacy,
    alt_edition_url:       common.title.alt_edition_url,
    traits:                common.traits.traits,
    trait_ids:             common.traits.trait_ids,
    source:                { book: common.source.book, page: common.source.page, source_id: common.source.source_id },
    sources:               common.sources,
    key_attribute:         keyAttr,
    hit_points_text:       hpRaw,
    hp_per_level,
    initial_proficiencies,
    class_dc,
  };
}
