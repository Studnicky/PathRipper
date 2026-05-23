// Trait concept slices and extraction.

import type { CheerioAPI } from 'cheerio';
import type { CommonExtraction, CheerioNode } from '../../common.js';
import {
  extractEntityId,
  stripStructuredKeys,
} from '../../common.js';
import {
  baseFrom,
  type SourceShape,
} from '../_helpers.js';
import type {
  TraitOutput,
  TraitBaseSlice,
} from './types.js';

export function extractTraitBase(c: CommonExtraction): TraitBaseSlice {
  return {
    _type:           'trait',
    url:             c.url,
    trait_id:        extractEntityId(c.url),
    name:            c.title.name,
    rarity:          c.traits.rarity,
    pfs:             c.title.pfs,
    legacy:          c.title.legacy,
    alt_edition_url: c.title.alt_edition_url,
    traits:          c.traits.traits,
    trait_ids:       c.traits.trait_ids,
    source:          { book: c.source.book, page: c.source.page, source_id: c.source.source_id },
    sources:         c.sources,
  };
}

const TRAIT_CLAIMED_LABELS: ReadonlyArray<string> = [
  'Source',
];

export function finalizeTrait(
  c:    CommonExtraction,
  base: TraitBaseSlice,
  $:    CheerioAPI,
): TraitOutput {
  // AON includes the trait's filter category (e.g. weapon/spell/creature) only
  // implicitly via the listing page; we infer from inbound link kinds.
  const linkKinds = new Set(c.links.map((l) => l.kind));
  let category: string | null = null;
  if (linkKinds.has('Spells'))      category = 'spell';
  else if (linkKinds.has('Weapons')) category = 'weapon';
  else if (linkKinds.has('Monsters') || linkKinds.has('Creatures')) category = 'creature';

  const baseShape = baseFrom(c, $);
  return {
    _type:           'trait',
    ...baseShape,
    url:             base.url,
    trait_id:        base.trait_id,
    name:            base.name,
    rarity:          base.rarity,
    pfs:             base.pfs,
    legacy:          base.legacy,
    alt_edition_url: base.alt_edition_url,
    traits:          base.traits,
    trait_ids:       base.trait_ids,
    source:          base.source,
    sources:         base.sources,
    raw_fields:      stripStructuredKeys(c.field_map, TRAIT_CLAIMED_LABELS),
    category,
  } satisfies TraitOutput;
}

export function extractTrait(c: CommonExtraction, $: CheerioAPI, _span: CheerioNode): TraitOutput {
  void _span;
  const base = extractTraitBase(c);
  return finalizeTrait(c, base, $);
}
