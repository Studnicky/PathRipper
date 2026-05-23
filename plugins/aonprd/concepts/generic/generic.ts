// Generic concept extraction and makeUnknown fallback.

import type { CheerioAPI } from 'cheerio';
import type { CommonExtraction, CheerioNode } from '../../common.js';
import { extractEntityId } from '../../common.js';
import { baseFrom } from '../_helpers.js';
import type {
  GenericOutput,
  UnknownOutput,
} from './types.js';

export function extractGeneric(c: CommonExtraction, _$: CheerioAPI, _span: CheerioNode): GenericOutput {
  void _span;
  return {
    _type:      'generic',
    ...baseFrom(c, _$),
    generic_id: extractEntityId(c.url),
    level:      c.title.level,
    level_kind: c.title.level_kind,
  };
}

/** Last-ditch shape used when even the content span couldn't be located. */
export function makeUnknown(url: string): UnknownOutput {
  return {
    _type:           'unknown',
    url,
    unknown_id:      extractEntityId(url),
    name:            '',
    rarity:          'common',
    pfs:             null,
    legacy:          false,
    alt_edition_url: null,
    traits:          [],
    trait_ids:       {},
    source:          { book: null, page: null, source_id: null },
    sources:         [],
    sections:        [],
    raw_fields:      {},
    links:           [],
    body_text:       '',
    body_html:       '',
    meta_description: null,
    meta_keywords:   null,
  };
}
