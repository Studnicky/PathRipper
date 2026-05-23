/**
 * Spell concept — base slice extraction.
 *
 * Extract identity, header scalars, traits, action cost, and source refs.
 * Node: extract:spell-base
 */
import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState }    from '../../../../src/state/ScrapeState.js';
import type { RipperServices } from '../../../../src/services/RipperServices.js';
import type { CommonExtraction, CheerioNode } from '../../common.js';
import { CAPABILITY_OUTPUTS, extractEntityId } from '../../common.js';

import type { SpellBaseSlice } from './types.js';
import { resolveKind } from './helpers.js';

/** Extract identity, header scalars, traits, and source refs. */
export function extractSpellBase(c: CommonExtraction, _$: CheerioAPI, _span: CheerioNode): SpellBaseSlice {
  return {
    _type:           'spell',
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

export type SpellBaseOutput = 'success' | 'error';

export const spellBaseNode: NodeInterface<ScrapeState, SpellBaseOutput, RipperServices> = {
  name:    'extract:spell-base',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'aonprdTarget'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: SpellBaseOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined || target === undefined) return { output: 'error' };

    const base = extractSpellBase(c, $, target);

    state.output = { ...state.output, ...base };

    return { output: 'success' };
  },
};
