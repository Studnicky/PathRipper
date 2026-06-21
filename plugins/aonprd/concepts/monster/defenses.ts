/**
 * Monster concept — defenses slice extraction.
 *
 * Exports: splitBodySections, extractMonsterDefenses, monsterDefensesNode.
 */
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';

import type { ScrapeState } from '../../../../src/state/ScrapeState.js';
import { CAPABILITY_OUTPUTS } from '../../common.js';
import type { CommonExtraction } from '../../common.js';
import type { MonsterDefensesSlice } from './types.js';
import { parseStatblockDefenses } from '../../capabilities/statblockDefenses.js';

/** Split body HTML on `<hr/>` into defenses + offense fragments. */
export function splitBodySections(bodyHtml: string): { defenses: string; offense: string } {
  const match = /<hr\s*\/?>/i.exec(bodyHtml);
  if (match === null) return { defenses: bodyHtml, offense: '' };
  return { defenses: bodyHtml.slice(0, match.index), offense: bodyHtml.slice(match.index + match[0].length) };
}

/** Extract defensive slice (AC, saves, HP, hardness, immunities, weaknesses, resistances). */
export function extractMonsterDefenses(common: CommonExtraction): MonsterDefensesSlice {
  const { defenses: defensesHtml } = splitBodySections(common.body_html);
  return parseStatblockDefenses(defensesHtml);
}

export type MonsterDefensesOutput = 'success' | 'error';

class MonsterDefensesNodeImpl extends ScalarNode<ScrapeState, MonsterDefensesOutput> {
  public readonly name    = 'extract:monster-defenses';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<MonsterDefensesOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const defenses = extractMonsterDefenses(common);

    state.output = { ...state.output, ...defenses };

    return NodeOutputBuilder.of('success');
  }
}
export const monsterDefensesNode = new MonsterDefensesNodeImpl();
