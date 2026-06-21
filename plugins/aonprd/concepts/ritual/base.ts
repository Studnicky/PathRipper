/**
 * Ritual concept — base slice extraction.
 *
 * Extracts identity, header scalars, traits, and source refs.
 * Node: extract:ritual-base
 */
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState } from '../../../../src/state/ScrapeState.js';
import type { CommonExtraction, CheerioNode } from '../../common.js';
import { CAPABILITY_OUTPUTS, extractEntityId } from '../../common.js';

import { resolveKind } from './helpers.js';
import type { RitualBaseSlice } from './types.js';

/** Extract identity, header scalars, traits, and source refs. */
export function extractSpellBase(common: CommonExtraction): RitualBaseSlice {
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

export type RitualBaseOutput = 'success' | 'error';

class RitualBaseNode extends ScalarNode<ScrapeState, RitualBaseOutput> {
  public readonly name = 'extract:ritual-base';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<RitualBaseOutput, SchemaObjectType> {
    return {
      // state.output merged with RitualBaseSlice (url, spell_id, name, kind, rank, rarity, pfs, traits, source, etc.)
      success: { type: 'object', properties: { output: { type: 'object' } }, required: ['output'] },
      error:   { type: 'object' },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
  ): Promise<NodeOutputType<RitualBaseOutput>> {
    const common  = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root    = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target  = state.getMetadata<CheerioNode>('aonprdTarget');
    if (common === undefined || root === undefined || target === undefined) return NodeOutputBuilder.of('error');

    void root;
    void target;
    const base = extractSpellBase(common);

    state.output = { ...state.output, ...base };

    return NodeOutputBuilder.of('success');
  }
}

export const ritualBaseNode = new RitualBaseNode();
