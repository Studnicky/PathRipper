/**
 * Monster concept — finalize slice.
 *
 * Exports: finalizeMonster, finalizeMonsterNode.
 * Strips claimed field labels from raw_fields and assembles final MonsterOutput.
 */
import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState } from '../../../../src/state/ScrapeState.js';
import type { RipperServices } from '../../../../src/services/RipperServices.js';
import { setConceptOutput } from '../_helpers.js';
import {
  extractMetaDescription,
  extractMetaKeywords,
  stripStructuredKeys,
} from '../../common.js';
import type { CommonExtraction, CheerioNode } from '../../common.js';
import type { MonsterOutput, MonsterOutputFields, MonsterBaseSlice, MonsterDefensesSlice, MonsterOffenseSlice, MonsterAbilitiesSlice, MonsterMetaSlice } from './types.js';
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
  c:         CommonExtraction,
  base:      MonsterBaseSlice,
  defenses:  MonsterDefensesSlice,
  offense:   MonsterOffenseSlice,
  abilities: MonsterAbilitiesSlice,
  meta:      MonsterMetaSlice,
  $:         CheerioAPI,
  _span:     CheerioNode,
): MonsterOutputFields {
  const claimedAbilityNames: string[] = [
    ...abilities.top_abilities.map((a) => a.name),
    ...abilities.defensive_abilities.map((a) => a.name),
    ...abilities.offensive_abilities.map((a) => a.name),
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
  for (const key of Object.keys(c.field_map)) {
    if (isVariantOverlayJunk(key)) junkKeys.push(key);
  }

  const raw_fields = stripStructuredKeys(c.field_map, [
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
    links:            c.links,
    body_text:        c.body_text,
    body_html:        c.body_html,
    meta_description: extractMetaDescription($),
    meta_keywords:    extractMetaKeywords($),
  } satisfies MonsterOutputFields;
}

export type FinalizeMonsterOutput = 'success';

export const finalizeMonsterNode: NodeInterface<ScrapeState, FinalizeMonsterOutput, RipperServices> = {
  name:    'finalize:monster',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'aonprdTarget'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FinalizeMonsterOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined || target === undefined) return { output: 'success' };
    const acc = (state.output ?? {}) as unknown as MonsterOutputFields;
    const assembled = finalizeMonster(c, acc, acc, acc, acc, acc, $, target);
    setConceptOutput(state, assembled);

    return { output: 'success' };
  },
};
