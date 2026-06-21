/**
 * Spell concept — base slice extraction.
 *
 * Extract identity, header scalars, traits, action cost, and source refs.
 * Node: extract:spell-base
 */
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState }    from '../../../../src/state/ScrapeState.js';
import type { CommonExtraction, CheerioNode } from '../../common.js';
import { CAPABILITY_OUTPUTS, extractEntityId } from '../../common.js';

import type { SpellBaseSlice } from './types.js';
import { resolveKind } from './helpers.js';

/** Extract identity, header scalars, traits, and source refs. */
export function extractSpellBase(common: CommonExtraction, _root: CheerioAPI, _span: CheerioNode): SpellBaseSlice {
  return {
    url:             common.url,
    spell_id:        extractEntityId(common.url),
    name:            common.title.name,
    kind:            resolveKind(common),
    rank:            common.title.level,
    rarity:          common.traits.rarity,
    pfs:             common.title.pfs,
    legacy:          common.title.legacy,
    alt_edition_url: common.title.alt_edition_url,
    action_cost:     common.title.action_cost,
    traits:          common.traits.traits,
    trait_ids:       common.traits.trait_ids,
    source:          { book: common.source.book, page: common.source.page, source_id: common.source.source_id },
    sources:         common.sources,
  };
}

export type SpellBaseOutput = 'success' | 'error';

class SpellBaseNodeImpl extends ScalarNode<ScrapeState, SpellBaseOutput> {
  public readonly name = 'extract:spell-base';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<'success' | 'error', SchemaObjectType> {
    return {
      // `success` — state.output merged with SpellBaseSlice
      success: { type: 'object' },
      // `error` — required metadata absent; no state mutation
      error: { type: 'object' },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<SpellBaseOutput>> {
    const common  = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root    = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target  = state.getMetadata<CheerioNode>('aonprdTarget');
    if (common === undefined || root === undefined || target === undefined) return NodeOutputBuilder.of('error');

    const base = extractSpellBase(common, root, target);

    state.output = { ...state.output, ...base };

    return NodeOutputBuilder.of('success');
  }
}
export const spellBaseNode = new SpellBaseNodeImpl();
