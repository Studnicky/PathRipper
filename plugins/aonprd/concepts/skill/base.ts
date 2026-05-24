// Skill concept — base slice extraction.
import type { CheerioAPI } from 'cheerio';
import type { CommonExtraction } from '../../common.js';
import { extractEntityId } from '../../common.js';
import { extractDescription, splitKeyAbility } from './helpers.js';
import type { SkillBaseSlice } from './types.js';

/** Extract identity + key-ability tag + sources + lead description. */
export function extractSkillBase(c: CommonExtraction, $: CheerioAPI, span: any): SkillBaseSlice {
  void $;
  const { name, key_ability } = splitKeyAbility(c.title.name);
  const description = extractDescription(span);

  return {
    url:              c.url,
    skill_id:         extractEntityId(c.url),
    name,
    key_ability,
    rarity:           c.traits.rarity,
    pfs:              c.title.pfs,
    legacy:           c.title.legacy,
    alt_edition_url:  c.title.alt_edition_url,
    traits:           c.traits.traits,
    trait_ids:        c.traits.trait_ids,
    source:           { book: c.source.book, page: c.source.page, source_id: c.source.source_id },
    sources:          c.sources,
    description_html: description.html,
    description_text: description.text,
  };
}
