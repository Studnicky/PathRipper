/**
 * Weapon concept declaration and extraction nodes.
 *
 * Imported by `plugins/aonprd/taxonomy/aonprd.ts`.
 * The base and mechanics nodes run in order, building up state.output incrementally.
 * The finalize node recomputes the full output from scratch so raw_fields can see
 * the complete picture of claimed labels.
 */
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';

import type { ScrapeState } from '../../../../src/state/ScrapeState.js';
import type { ConceptDecl } from '../../../../src/taxonomy/Taxonomy.js';
import type { CommonExtraction } from '../../common.js';
import { CAPABILITY_OUTPUTS } from '../../common.js';
import type { WeaponOutput } from './types.js';
import { extractWeaponBase } from './base.js';
import { extractWeaponMechanics } from './mechanics.js';
import { finalizeWeaponNode } from './finalize.js';

export type { WeaponOutput } from './types.js';

export type WeaponBaseOutput = 'success' | 'error';

class WeaponBaseNode extends ScalarNode<ScrapeState, WeaponBaseOutput> {
  public readonly name = 'extract:weapon-base';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<'success' | 'error', SchemaObjectType> {
    return {
      // `success` — state.output merged with WeaponBaseSlice
      success: { type: 'object' },
      error:   { type: 'object' },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<WeaponBaseOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const base = extractWeaponBase(common);

    state.output = { ...state.output, ...base };

    return NodeOutputBuilder.of('success');
  }
}

export const weaponBaseNode = new WeaponBaseNode();

// ─────────────────────────────────────────────────────────────────────────────

export type WeaponMechanicsOutput = 'success' | 'error';

class WeaponMechanicsNode extends ScalarNode<ScrapeState, WeaponMechanicsOutput> {
  public readonly name = 'extract:weapon-mechanics';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<'success' | 'error', SchemaObjectType> {
    return {
      // `success` — state.output merged with WeaponMechanicsSlice
      success: { type: 'object' },
      error:   { type: 'object' },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<WeaponMechanicsOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const mechanics = extractWeaponMechanics(common);

    state.output = { ...state.output, ...mechanics };

    return NodeOutputBuilder.of('success');
  }
}

export const weaponMechanicsNode = new WeaponMechanicsNode();

// ─────────────────────────────────────────────────────────────────────────────

export const weaponConcept: ConceptDecl<WeaponOutput> = {
  id:       'weapon',
  parent:   'entity',
  urlPaths: ['weapons'],
  capabilities: [
    weaponBaseNode,
    weaponMechanicsNode,
    finalizeWeaponNode,
  ],
};
