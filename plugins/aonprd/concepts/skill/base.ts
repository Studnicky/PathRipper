// Skill concept — base slice extraction.
import type { CheerioAPI } from 'cheerio';
import type { CommonExtraction } from '../../common.js';
import { extractEntityId } from '../../common.js';
import { extractDescription, splitKeyAbility } from './helpers.js';
import type { SkillBaseSlice } from './types.js';

/** Extract identity + key-ability tag + sources + lead description. */
export function extractSkillBase(common: CommonExtraction, _root: CheerioAPI, span: unknown): SkillBaseSlice {
  void _root;
  const { name, key_ability } = splitKeyAbility(common.title.name);
  const description = extractDescription(span);

  return {
    url:              common.url,
    skill_id:         extractEntityId(common.url),
    name,
    key_ability,
    rarity:           common.traits.rarity,
    pfs:              common.title.pfs,
    legacy:           common.title.legacy,
    alt_edition_url:  common.title.alt_edition_url,
    traits:           common.traits.traits,
    trait_ids:        common.traits.trait_ids,
    source:           { book: common.source.book, page: common.source.page, source_id: common.source.source_id },
    sources:          common.sources,
    description_html: description.html,
    description_text: description.text,
  };
}
