/**
 * Weapon finalization — assemble final output and node interface.
 */
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState } from '../../../../src/state/ScrapeState.js';
import type { CommonExtraction, CheerioNode } from '../../common.js';
import { extractMetaDescription, extractMetaKeywords, extractPfsNote, stripStructuredKeys } from '../../common.js';
import { setConceptOutput } from '../_helpers.js';
import type { WeaponOutput, WeaponBaseSlice, WeaponMechanicsSlice, WeaponMetaSlice } from './types.js';
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
  common:    CommonExtraction,
  base:      WeaponBaseSlice,
  mechanics: WeaponMechanicsSlice,
  meta:      WeaponMetaSlice,
  root:      CheerioAPI,
): WeaponOutput {
  const raw_fields = stripStructuredKeys(common.field_map, WEAPON_CLAIMED_LABELS);
  return {
    ...base,
    ...mechanics,
    ...meta,
    raw_fields,
    links:            common.links,
    meta_description: extractMetaDescription(root),
    meta_keywords:    extractMetaKeywords(root),
  } satisfies WeaponOutput;
}

export type FinalizeWeaponOutput = 'success';

class FinalizeWeaponNode extends ScalarNode<ScrapeState, FinalizeWeaponOutput> {
  public readonly name = 'finalize:weapon';
  public readonly outputs = ['success'] as const;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<FinalizeWeaponOutput>> {
    const common  = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root    = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target  = state.getMetadata<CheerioNode>('aonprdTarget');
    if (common === undefined || root === undefined || target === undefined) return NodeOutputBuilder.of('success');
    const acc = (state.output ?? {}) as unknown as WeaponOutput;
    const meta = extractWeaponMeta(common, root, target);
    const pfs_note = extractPfsNote(root, target);
    const assembled = finalizeWeapon(common, acc, acc, meta, root);
    setConceptOutput(state, {
      ...assembled,
      pfs_note,
      links: common.links,
      meta_description: extractMetaDescription(root),
      meta_keywords:    extractMetaKeywords(root),
    } satisfies WeaponOutput);

    return NodeOutputBuilder.of('success');
  }
}

export const finalizeWeaponNode = new FinalizeWeaponNode();
