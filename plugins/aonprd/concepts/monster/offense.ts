/**
 * Monster concept — offense slice extraction.
 *
 * Exports: extractMonsterOffense, monsterOffenseNode.
 */
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState } from '../../../../src/state/ScrapeState.js';
import { CAPABILITY_OUTPUTS } from '../../common.js';
import type { CommonExtraction, CheerioNode } from '../../common.js';
import type { MonsterOffenseSlice } from './types.js';
import { parseStatblockOffense } from '../../capabilities/statblockOffense.js';
import { splitBodySections } from './defenses.js';

/** Extract offensive slice (speed, strikes, spell lists). */
export function extractMonsterOffense(common: CommonExtraction, _root: CheerioAPI, _span: CheerioNode): MonsterOffenseSlice {
  const { offense: offenseHtml } = splitBodySections(common.body_html);
  return parseStatblockOffense(offenseHtml, common);
}

export type MonsterOffenseOutput = 'success' | 'error';

class MonsterOffenseNode extends ScalarNode<ScrapeState, MonsterOffenseOutput> {
  public readonly name    = 'extract:monster-offense';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<MonsterOffenseOutput>> {
    const common  = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root    = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target  = state.getMetadata<CheerioNode>('aonprdTarget');
    if (common === undefined || root === undefined || target === undefined) return NodeOutputBuilder.of('error');

    const offense = extractMonsterOffense(common, root, target);

    state.output = { ...state.output, ...offense };

    return NodeOutputBuilder.of('success');
  }
}

export const monsterOffenseNode = new MonsterOffenseNode();
