/**
 * Monster concept — defenses slice extraction.
 *
 * Exports: splitBodySections, extractMonsterDefenses, monsterDefensesNode.
 */
import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';

import type { ScrapeState } from '../../../../src/state/ScrapeState.js';
import type { RipperServices } from '../../../../src/services/RipperServices.js';
import { CAPABILITY_OUTPUTS } from '../../common.js';
import type { CommonExtraction } from '../../common.js';
import type { MonsterDefensesSlice } from './types.js';
import { parseStatblockDefenses } from '../../capabilities/statblockDefenses.js';

/** Split body HTML on `<hr/>` into defenses + offense fragments. */
export function splitBodySections(bodyHtml: string): { defenses: string; offense: string } {
  const m = /<hr\s*\/?>/i.exec(bodyHtml);
  if (m === null) return { defenses: bodyHtml, offense: '' };
  return { defenses: bodyHtml.slice(0, m.index), offense: bodyHtml.slice(m.index + m[0].length) };
}

/** Extract defensive slice (AC, saves, HP, hardness, immunities, weaknesses, resistances). */
export function extractMonsterDefenses(c: CommonExtraction): MonsterDefensesSlice {
  const { defenses: defensesHtml } = splitBodySections(c.body_html);
  return parseStatblockDefenses(defensesHtml);
}

export type MonsterDefensesOutput = 'success' | 'error';

export const monsterDefensesNode: NodeInterface<ScrapeState, MonsterDefensesOutput, RipperServices> = {
  name:    'extract:monster-defenses',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: MonsterDefensesOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const defenses = extractMonsterDefenses(c);

    state.output = { ...state.output, ...defenses };

    return { output: 'success' };
  },
};
