/**
 * Monster concept — finalize slice.
 *
 * Exports: finalizeMonster, finalizeMonsterNode.
 * Strips claimed field labels from raw_fields and assembles final MonsterOutput.
 */
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';
import type { OperationContractFragmentType } from '@studnicky/dagonizer/contracts';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState } from '../../../../src/state/ScrapeState.js';
import { setConceptOutput } from '../_helpers.js';
import {
  extractMetaDescription,
  extractMetaKeywords,
  stripStructuredKeys,
} from '../../common.js';
import type { CommonExtraction, CheerioNode } from '../../common.js';
import type { MonsterOutput, MonsterBaseSlice, MonsterDefensesSlice, MonsterOffenseSlice, MonsterAbilitiesSlice, MonsterMetaSlice } from './types.js';
import { isVariantOverlayJunk } from './abilities.js';

const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Source', 'Recall Knowledge', 'Perception', 'Languages', 'Skills', 'Items',
  'Str', 'Dex', 'Con', 'Int', 'Wis', 'Cha',
  'AC', 'Fort', 'Ref', 'Will', 'HP', 'Hardness',
  'Immunities', 'Weaknesses', 'Resistances',
  'Speed', 'Melee', 'Ranged',
  'Elite', 'Normal', 'Weak', 'Proficiency without Level',
  'Frequency', 'Trigger', 'Requirements', 'Effect',
  'Background', 'Heritage', 'PFS Note',
  'Rogue\'s Racket', "Rogue's Racket",
  'Cleric Doctrine', 'Sorcerer Bloodline', 'Bloodline', 'Doctrine',
  'Style', 'Patron', 'Mystery', 'Methodology', 'Research Field',
  'Druidic Order', 'Hunter\'s Edge', "Hunter's Edge",
  'Apothecary\'s Tincture', "Apothecary's Tincture",
  'Damage', 'Suit', 'Harrowkin Suit',
];

/**
 * Assemble the final MonsterOutput from per-slice results.
 *
 * Computes `raw_fields` by stripping every label claimed by upstream slices,
 * every captured ability name, every spell-list label, and every variant-overlay
 * junk key. Whatever remains is genuine unstructured residue.
 */
export function finalizeMonster(
  common:    CommonExtraction,
  base:      MonsterBaseSlice,
  defenses:  MonsterDefensesSlice,
  offense:   MonsterOffenseSlice,
  abilities: MonsterAbilitiesSlice,
  meta:      MonsterMetaSlice,
  root:      CheerioAPI,
  _span:     CheerioNode,
): MonsterOutput {
  const claimedAbilityNames: string[] = [
    ...abilities.top_abilities.map((ability) => ability.name),
    ...abilities.defensive_abilities.map((ability) => ability.name),
    ...abilities.offensive_abilities.map((ability) => ability.name),
  ];

  const claimedSpellListLabels: string[] = [];
  for (const list of offense.spell_lists) {
    const tradition = list.tradition === null ? '' : `${list.tradition} `;
    const kindWord =
      list.kind === 'spells'  ? 'Spells'  :
      list.kind === 'innate'  ? 'Innate Spells' :
      list.kind === 'focus'   ? 'Focus Spells'  :
      'Rituals';
    claimedSpellListLabels.push(`${tradition}${kindWord}`.trim());
  }

  const junkKeys: string[] = [];
  for (const key of Object.keys(common.field_map)) {
    if (isVariantOverlayJunk(key)) junkKeys.push(key);
  }

  const raw_fields = stripStructuredKeys(common.field_map, [
    ...CLAIMED_FIELD_LABELS,
    ...claimedAbilityNames,
    ...claimedSpellListLabels,
    ...junkKeys,
  ]);

  return {
    ...base,
    ...defenses,
    ...offense,
    ...abilities,
    ...meta,
    raw_fields,
    links:            common.links,
    body_text:        common.body_text,
    body_html:        common.body_html,
    meta_description: extractMetaDescription(root),
    meta_keywords:    extractMetaKeywords(root),
  } satisfies MonsterOutput;
}

export type FinalizeMonsterOutput = 'success';

class FinalizeMonsterNodeImpl extends ScalarNode<ScrapeState, FinalizeMonsterOutput> {
  public readonly name = 'finalize:monster';
  public readonly outputs = ['success'] as const;
  public override readonly contract: OperationContractFragmentType = {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'aonprdTarget'],
    produces:     [],
  };

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<FinalizeMonsterOutput>> {
    const common  = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root    = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target  = state.getMetadata<CheerioNode>('aonprdTarget');
    if (common === undefined || root === undefined || target === undefined) return NodeOutputBuilder.of('success');
    const acc = (state.output ?? {}) as unknown as MonsterOutput;
    const assembled = finalizeMonster(common, acc, acc, acc, acc, acc, root, target);
    setConceptOutput(state, assembled);

    return NodeOutputBuilder.of('success');
  }
}
export const finalizeMonsterNode = new FinalizeMonsterNodeImpl();
