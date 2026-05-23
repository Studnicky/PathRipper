/**
 * Monster concept — offense slice extraction.
 *
 * Exports: extractMonsterOffense, monsterOffenseNode.
 */
import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState } from '../../../../src/state/ScrapeState.js';
import type { RipperServices } from '../../../../src/services/RipperServices.js';
import { CAPABILITY_OUTPUTS } from '../../common.js';
import type { CommonExtraction, CheerioNode } from '../../common.js';
import type { MonsterOffenseSlice } from './types.js';
import { parseStatblockOffense } from '../../capabilities/statblockOffense.js';
import { splitBodySections } from './defenses.js';

/** Extract offensive slice (speed, strikes, spell lists). */
export function extractMonsterOffense(c: CommonExtraction, _$: CheerioAPI, _span: CheerioNode): MonsterOffenseSlice {
  const { offense: offenseHtml } = splitBodySections(c.body_html);
  return parseStatblockOffense(offenseHtml, c);
}

export type MonsterOffenseOutput = 'success' | 'error';

export const monsterOffenseNode: NodeInterface<ScrapeState, MonsterOffenseOutput, RipperServices> = {
  name:    'extract:monster-offense',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'aonprdTarget'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: MonsterOffenseOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined || target === undefined) return { output: 'error' };

    const offense = extractMonsterOffense(c, $, target);

    state.output = { ...state.output, ...offense };

    return { output: 'success' };
  },
};
