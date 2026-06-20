// Trait concept slices and extraction.

import type { CheerioAPI } from 'cheerio';
import type { CommonExtraction, CheerioNode } from '../../common.js';
import {
  extractEntityId,
  stripStructuredKeys,
} from '../../common.js';
import {
  baseFrom,
} from '../_helpers.js';
import type {
  TraitOutput,
  TraitBaseSlice,
} from './types.js';

export function extractTraitBase(common: CommonExtraction): TraitBaseSlice {
  return {
    url:             common.url,
    trait_id:        extractEntityId(common.url),
    name:            common.title.name,
    rarity:          common.traits.rarity,
    pfs:             common.title.pfs,
    legacy:          common.title.legacy,
    alt_edition_url: common.title.alt_edition_url,
    traits:          common.traits.traits,
    trait_ids:       common.traits.trait_ids,
    source:          { book: common.source.book, page: common.source.page, source_id: common.source.source_id },
    sources:         common.sources,
  };
}

const TRAIT_CLAIMED_LABELS: ReadonlyArray<string> = [
  'Source',
];

export function finalizeTrait(
  common: CommonExtraction,
  base:   TraitBaseSlice,
  root:   CheerioAPI,
): TraitOutput {
  // AON includes the trait's filter category (e.g. weapon/spell/creature) only
  // implicitly via the listing page; we infer from inbound link kinds.
  const linkKinds = new Set(common.links.map((link) => link.kind));
  let category: string | null = null;
  if (linkKinds.has('Spells'))      category = 'spell';
  else if (linkKinds.has('Weapons')) category = 'weapon';
  else if (linkKinds.has('Monsters') || linkKinds.has('Creatures')) category = 'creature';

  const baseShape = baseFrom(common, root);
  return {
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
    raw_fields:      stripStructuredKeys(common.field_map, TRAIT_CLAIMED_LABELS),
    category,
  } satisfies TraitOutput;
}

export function extractTrait(common: CommonExtraction, root: CheerioAPI, _span: CheerioNode): TraitOutput {
  void _span;
  const base = extractTraitBase(common);
  return finalizeTrait(common, base, root);
}
