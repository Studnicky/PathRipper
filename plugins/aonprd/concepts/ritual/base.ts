/**
 * Ritual concept — base slice extraction.
 *
 * Extracts identity, header scalars, traits, and source refs.
 * Node: extract:ritual-base
 */
import type { NodeInterface } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState } from '../../../../src/state/ScrapeState.js';
import type { RipperServices } from '../../../../src/services/RipperServices.js';
import type { CommonExtraction, CheerioNode } from '../../common.js';
import { CAPABILITY_OUTPUTS, extractEntityId } from '../../common.js';

import { resolveKind } from './helpers.js';
import type { RitualBaseSlice } from './types.js';

/** Extract identity, header scalars, traits, and source refs. */
export function extractSpellBase(c: CommonExtraction): RitualBaseSlice {
  return {
    url:             c.url,
    spell_id:        extractEntityId(c.url),
    name:            c.title.name,
    kind:            resolveKind(c),
    rank:            c.title.level,
    rarity:          c.traits.rarity,
    pfs:             c.title.pfs,
    legacy:          c.title.legacy,
    alt_edition_url: c.title.alt_edition_url,
    action_cost:     c.title.action_cost,
    traits:          c.traits.traits,
    trait_ids:       c.traits.trait_ids,
    source:          { book: c.source.book, page: c.source.page, source_id: c.source.source_id },
    sources:         c.sources,
  };
}

export type RitualBaseOutput = 'success' | 'error';

export const ritualBaseNode: NodeInterface<ScrapeState, RitualBaseOutput, RipperServices> = {
  name:    'extract:ritual-base',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'aonprdTarget'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
  ): Promise<{ output: RitualBaseOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined || target === undefined) return { output: 'error' };

    void $;
    void target;
    const base = extractSpellBase(c);

    state.output = { ...state.output, ...base };

    return { output: 'success' };
  },
};
