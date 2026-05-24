/**
 * Weapon finalization — assemble final output and node interface.
 */
import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState } from '../../../../src/state/ScrapeState.js';
import type { RipperServices } from '../../../../src/services/RipperServices.js';
import type { CommonExtraction, CheerioNode } from '../../common.js';
import { extractMetaDescription, extractMetaKeywords, extractPfsNote, stripStructuredKeys } from '../../common.js';
import { setConceptOutput } from '../_helpers.js';
import { CAPABILITY_OUTPUTS } from '../../common.js';
import type { WeaponOutput, WeaponOutputFields, WeaponBaseSlice, WeaponMechanicsSlice, WeaponMetaSlice } from './types.js';
import { extractWeaponMeta } from './meta.js';

/** AON header labels claimed by the weapon slices (stripped from raw_fields). */
const WEAPON_CLAIMED_LABELS: ReadonlyArray<string> = [
  'Source',
  'Price', 'Damage', 'Bulk', 'Hands', 'Reload', 'Range', 'Ammunition',
  'Type', 'Category', 'Group',
  'Favored Weapon', 'Access',
];

/** Assemble a WeaponOutput from per-slice results, stripping claimed labels from raw_fields. */
export function finalizeWeapon(
  c:         CommonExtraction,
  base:      WeaponBaseSlice,
  mechanics: WeaponMechanicsSlice,
  meta:      WeaponMetaSlice,
  $:         CheerioAPI,
): WeaponOutputFields {
  const raw_fields = stripStructuredKeys(c.field_map, WEAPON_CLAIMED_LABELS);
  return {
    ...base,
    ...mechanics,
    ...meta,
    raw_fields,
    links:            c.links,
    meta_description: extractMetaDescription($),
    meta_keywords:    extractMetaKeywords($),
  } satisfies WeaponOutputFields;
}

export type FinalizeWeaponOutput = 'success';

export const finalizeWeaponNode: NodeInterface<ScrapeState, FinalizeWeaponOutput, RipperServices> = {
  name:    'finalize:weapon',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'aonprdTarget'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FinalizeWeaponOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined || target === undefined) return { output: 'success' };
    const acc = (state.output ?? {}) as unknown as WeaponOutputFields;
    const meta = extractWeaponMeta(c, $, target);
    const pfs_note = extractPfsNote($, target);
    const assembled = finalizeWeapon(c, acc, acc, meta, $);
    setConceptOutput(state, {
      ...assembled,
      pfs_note,
      links: c.links,
      meta_description: extractMetaDescription($),
      meta_keywords:    extractMetaKeywords($),
    } satisfies WeaponOutputFields);

    return { output: 'success' };
  },
};
