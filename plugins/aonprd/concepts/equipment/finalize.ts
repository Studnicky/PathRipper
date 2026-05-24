/**
 * Equipment concept — finalize assembly and capability nodes.
 *
 * Exports: extractWeapon, extractArmor, extractEquipment,
 * finalizeWeapon, finalizeArmor, finalizeEquipment,
 * equipmentBaseNode, equipmentMechanicsNode, finalizeEquipmentNode,
 * EquipmentBaseOutput, EquipmentMechanicsOutput, FinalizeEquipmentOutput.
 */
import type { NodeInterface } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState }    from '../../../../src/state/ScrapeState.js';
import type { RipperServices } from '../../../../src/services/RipperServices.js';
import { setConceptOutput } from '../_helpers.js';
import {
  CAPABILITY_OUTPUTS,
  type CommonExtraction,
  type CheerioNode,
  extractMetaDescription,
  extractMetaKeywords,
  stripStructuredKeys,
  extractPfsNote,
} from '../../common.js';
import type {
  WeaponOutput,
  WeaponOutputFields,
  ArmorOutput,
  ArmorOutputFields,
  EquipmentOutput,
  EquipmentOutputFields,
  WeaponBaseSlice,
  WeaponMechanicsSlice,
  WeaponMetaSlice,
  ArmorBaseSlice,
  ArmorMechanicsSlice,
  ArmorMetaSlice,
  EquipmentBaseSlice,
  EquipmentMechanicsSlice,
  EquipmentMetaSlice,
} from './types.js';
import {
  extractWeaponBase,
  extractArmorBase,
  extractEquipmentBase,
} from './base.js';
import {
  extractWeaponMechanics,
  extractArmorMechanics,
  extractEquipmentMechanics,
} from './mechanics.js';
import {
  extractWeaponMeta,
  extractArmorMeta,
  extractEquipmentMeta,
} from './meta.js';

/** AON header labels claimed by the weapon slices (stripped from raw_fields). */
const WEAPON_CLAIMED_LABELS: ReadonlyArray<string> = [
  'Source',
  'Price', 'Damage', 'Bulk', 'Hands', 'Reload', 'Range', 'Ammunition',
  'Type', 'Category', 'Group',
  'Favored Weapon', 'Access',
];

/** AON header labels claimed by the armor slices (stripped from raw_fields). */
const ARMOR_CLAIMED_LABELS: ReadonlyArray<string> = [
  'Source',
  'Price', 'AC Bonus', 'Dex Cap', 'Check Penalty', 'Speed Penalty', 'Strength',
  'Bulk', 'Category', 'Group',
  'Hardness', 'HP (BT)', 'HP', 'BT',
];

/** AON header labels claimed by the equipment slices (stripped from raw_fields). */
const EQUIPMENT_CLAIMED_LABELS: ReadonlyArray<string> = [
  'Source',
  'Price', 'Bulk', 'Usage', 'Hands',
  'Activate',
  'Frequency', 'Trigger', 'Requirements', 'Effect', 'Onset', 'Duration',
  'Craft Requirements', 'Access', 'Benefit', 'Drawback', 'Cost', 'Saving Throw',
  'Base Armor', 'Base Weapon',
  // Spirit-armor / aligned-item incidentals.
  'Suit', 'Alignment',
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

/** Assemble an ArmorOutput from per-slice results, stripping claimed labels from raw_fields. */
export function finalizeArmor(
  c:         CommonExtraction,
  base:      ArmorBaseSlice,
  mechanics: ArmorMechanicsSlice,
  meta:      ArmorMetaSlice,
  $:         CheerioAPI,
): ArmorOutputFields {
  const raw_fields = stripStructuredKeys(c.field_map, ARMOR_CLAIMED_LABELS);
  return {
    ...base,
    ...mechanics,
    ...meta,
    raw_fields,
    links:            c.links,
    meta_description: extractMetaDescription($),
    meta_keywords:    extractMetaKeywords($),
  } satisfies ArmorOutputFields;
}

/** Assemble an EquipmentOutput from per-slice results, stripping claimed labels from raw_fields. */
export function finalizeEquipment(
  c:         CommonExtraction,
  base:      EquipmentBaseSlice,
  mechanics: EquipmentMechanicsSlice,
  meta:      EquipmentMetaSlice,
  $:         CheerioAPI,
): EquipmentOutputFields {
  const raw_fields = stripStructuredKeys(c.field_map, EQUIPMENT_CLAIMED_LABELS);
  return {
    ...base,
    ...mechanics,
    ...meta,
    raw_fields,
    links:            c.links,
    meta_description: extractMetaDescription($),
    meta_keywords:    extractMetaKeywords($),
  } satisfies EquipmentOutputFields;
}

/** Project a CommonExtraction of a Weapons.aspx page into a typed WeaponOutputFields. */
export function extractWeapon(c: CommonExtraction, $: CheerioAPI, span: CheerioNode): WeaponOutputFields {
  const base      = extractWeaponBase(c);
  const mechanics = extractWeaponMechanics(c);
  const meta      = extractWeaponMeta(c, $, span);
  return finalizeWeapon(c, base, mechanics, meta, $);
}

/** Project a CommonExtraction of an Armor.aspx page into a typed ArmorOutputFields. */
export function extractArmor(c: CommonExtraction, $: CheerioAPI, span: CheerioNode): ArmorOutputFields {
  void span;
  const base      = extractArmorBase(c);
  const mechanics = extractArmorMechanics(c);
  const meta      = extractArmorMeta(c);
  return finalizeArmor(c, base, mechanics, meta, $);
}

/** Project a CommonExtraction of an Equipment.aspx page into a typed EquipmentOutputFields. */
export function extractEquipment(c: CommonExtraction, $: CheerioAPI, span: CheerioNode): EquipmentOutputFields {
  void span;
  const base      = extractEquipmentBase(c);
  const mechanics = extractEquipmentMechanics(c);
  const meta      = extractEquipmentMeta(c);
  return finalizeEquipment(c, base, mechanics, meta, $);
}

// ─── Capability nodes ─────────────────────────────────────────────────────────

export type EquipmentBaseOutput = 'success' | 'error';

export const equipmentBaseNode: NodeInterface<ScrapeState, EquipmentBaseOutput, RipperServices> = {
  name:    'extract:equipment-base',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
  ): Promise<{ output: EquipmentBaseOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const base = extractEquipmentBase(c);

    state.output = { ...state.output, ...base };

    return { output: 'success' };
  },
};

export type EquipmentMechanicsOutput = 'success' | 'error';

export const equipmentMechanicsNode: NodeInterface<ScrapeState, EquipmentMechanicsOutput, RipperServices> = {
  name:    'extract:equipment-mechanics',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
  ): Promise<{ output: EquipmentMechanicsOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const mechanics = extractEquipmentMechanics(c);

    state.output = { ...state.output, ...mechanics };

    return { output: 'success' };
  },
};

export type FinalizeEquipmentOutput = 'success';

export const finalizeEquipmentNode: NodeInterface<ScrapeState, FinalizeEquipmentOutput, RipperServices> = {
  name:    'finalize:equipment',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'aonprdTarget'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
  ): Promise<{ output: FinalizeEquipmentOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined || target === undefined) return { output: 'success' };
    const acc = (state.output ?? {}) as unknown as EquipmentOutputFields;
    const meta = extractEquipmentMeta(c);
    const pfs_note = extractPfsNote($, target);
    const assembled = finalizeEquipment(c, acc, acc, meta, $);
    setConceptOutput(state, {
      ...assembled,
      pfs_note,
    } satisfies EquipmentOutputFields);

    return { output: 'success' };
  },
};
