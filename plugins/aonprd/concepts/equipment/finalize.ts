/**
 * Equipment concept — finalize assembly and capability nodes.
 *
 * Exports: extractWeapon, extractArmor, extractEquipment,
 * finalizeWeapon, finalizeArmor, finalizeEquipment,
 * equipmentBaseNode, equipmentMechanicsNode, finalizeEquipmentNode,
 * EquipmentBaseOutput, EquipmentMechanicsOutput, FinalizeEquipmentOutput.
 */
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeOutputType } from '@studnicky/dagonizer';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState }    from '../../../../src/state/ScrapeState.js';
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
  ArmorOutput,
  EquipmentOutput,
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

/** Assemble an ArmorOutput from per-slice results, stripping claimed labels from raw_fields. */
export function finalizeArmor(
  common:    CommonExtraction,
  base:      ArmorBaseSlice,
  mechanics: ArmorMechanicsSlice,
  meta:      ArmorMetaSlice,
  root:      CheerioAPI,
): ArmorOutput {
  const raw_fields = stripStructuredKeys(common.field_map, ARMOR_CLAIMED_LABELS);
  return {
    ...base,
    ...mechanics,
    ...meta,
    raw_fields,
    links:            common.links,
    meta_description: extractMetaDescription(root),
    meta_keywords:    extractMetaKeywords(root),
  } satisfies ArmorOutput;
}

/** Assemble an EquipmentOutput from per-slice results, stripping claimed labels from raw_fields. */
export function finalizeEquipment(
  common:    CommonExtraction,
  base:      EquipmentBaseSlice,
  mechanics: EquipmentMechanicsSlice,
  meta:      EquipmentMetaSlice,
  root:      CheerioAPI,
): EquipmentOutput {
  const raw_fields = stripStructuredKeys(common.field_map, EQUIPMENT_CLAIMED_LABELS);
  return {
    ...base,
    ...mechanics,
    ...meta,
    raw_fields,
    links:            common.links,
    meta_description: extractMetaDescription(root),
    meta_keywords:    extractMetaKeywords(root),
  } satisfies EquipmentOutput;
}

/** Project a CommonExtraction of a Weapons.aspx page into a typed WeaponOutput. */
export function extractWeapon(common: CommonExtraction, root: CheerioAPI, span: CheerioNode): WeaponOutput {
  const base      = extractWeaponBase(common);
  const mechanics = extractWeaponMechanics(common);
  const meta      = extractWeaponMeta(common, root, span);
  return finalizeWeapon(common, base, mechanics, meta, root);
}

/** Project a CommonExtraction of an Armor.aspx page into a typed ArmorOutput. */
export function extractArmor(common: CommonExtraction, root: CheerioAPI, span: CheerioNode): ArmorOutput {
  void span;
  const base      = extractArmorBase(common);
  const mechanics = extractArmorMechanics(common);
  const meta      = extractArmorMeta(common);
  return finalizeArmor(common, base, mechanics, meta, root);
}

/** Project a CommonExtraction of an Equipment.aspx page into a typed EquipmentOutput. */
export function extractEquipment(common: CommonExtraction, root: CheerioAPI, span: CheerioNode): EquipmentOutput {
  void span;
  const base      = extractEquipmentBase(common);
  const mechanics = extractEquipmentMechanics(common);
  const meta      = extractEquipmentMeta(common);
  return finalizeEquipment(common, base, mechanics, meta, root);
}

// ─── Capability nodes ─────────────────────────────────────────────────────────

export type EquipmentBaseOutput = 'success' | 'error';

class EquipmentBaseNode extends ScalarNode<ScrapeState, EquipmentBaseOutput> {
  public readonly name    = 'extract:equipment-base';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
  ): Promise<NodeOutputType<EquipmentBaseOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const base = extractEquipmentBase(common);

    state.output = { ...state.output, ...base };

    return NodeOutputBuilder.of('success');
  }
}

export const equipmentBaseNode = new EquipmentBaseNode();

export type EquipmentMechanicsOutput = 'success' | 'error';

class EquipmentMechanicsNode extends ScalarNode<ScrapeState, EquipmentMechanicsOutput> {
  public readonly name    = 'extract:equipment-mechanics';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
  ): Promise<NodeOutputType<EquipmentMechanicsOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const mechanics = extractEquipmentMechanics(common);

    state.output = { ...state.output, ...mechanics };

    return NodeOutputBuilder.of('success');
  }
}

export const equipmentMechanicsNode = new EquipmentMechanicsNode();

export type FinalizeEquipmentOutput = 'success';

class FinalizeEquipmentNode extends ScalarNode<ScrapeState, FinalizeEquipmentOutput> {
  public readonly name    = 'finalize:equipment';
  public readonly outputs = ['success'] as const;

  protected override async executeOne(
    state: ScrapeState,
  ): Promise<NodeOutputType<FinalizeEquipmentOutput>> {
    const common  = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root    = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target  = state.getMetadata<CheerioNode>('aonprdTarget');
    if (common === undefined || root === undefined || target === undefined) return NodeOutputBuilder.of('success');
    const acc = (state.output ?? {}) as unknown as EquipmentOutput;
    const meta = extractEquipmentMeta(common);
    const pfs_note = extractPfsNote(root, target);
    const assembled = finalizeEquipment(common, acc, acc, meta, root);
    setConceptOutput(state, {
      ...assembled,
      pfs_note,
    } satisfies EquipmentOutput);

    return NodeOutputBuilder.of('success');
  }
}

export const finalizeEquipmentNode = new FinalizeEquipmentNode();
