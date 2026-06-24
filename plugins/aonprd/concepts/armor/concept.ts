// Armor concept declaration and capability nodes.

import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState }    from '../../../../src/state/ScrapeState.js';
import type { ConceptDecl } from '../../../../src/types/Taxonomy.js';
import type { CommonExtraction } from '../../common.js';
import { CAPABILITY_OUTPUTS } from '../../common.js';
import { setConceptOutput } from '../_helpers.js';
import type { ArmorOutput } from './types.js';
import { extractArmorBase } from './base.js';
import { extractArmorMechanics } from './mechanics.js';
import { extractArmorMeta } from './meta.js';
import { finalizeArmor } from './finalize.js';

export type ArmorBaseOutput = 'success' | 'error';

class ArmorBaseNode extends ScalarNode<ScrapeState, ArmorBaseOutput> {
  public readonly name    = 'extract:armor-base';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<ArmorBaseOutput, SchemaObjectType> {
    return {
      success: {
        type: 'object',
        properties: {
          output: { type: 'object' },
        },
        required: ['output'],
      },
      error: { type: 'object' },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<ArmorBaseOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const base = extractArmorBase(common);

    state.output = { ...state.output, ...base };

    return NodeOutputBuilder.of('success');
  }
}

export const armorBaseNode = new ArmorBaseNode();

export type ArmorMechanicsOutput = 'success' | 'error';

class ArmorMechanicsNode extends ScalarNode<ScrapeState, ArmorMechanicsOutput> {
  public readonly name    = 'extract:armor-mechanics';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<ArmorMechanicsOutput, SchemaObjectType> {
    return {
      success: {
        type: 'object',
        properties: {
          output: { type: 'object' },
        },
        required: ['output'],
      },
      error: { type: 'object' },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<ArmorMechanicsOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const mechanics = extractArmorMechanics(common);

    state.output = { ...state.output, ...mechanics };

    return NodeOutputBuilder.of('success');
  }
}

export const armorMechanicsNode = new ArmorMechanicsNode();

export type FinalizeArmorOutput = 'success';

class FinalizeArmorNode extends ScalarNode<ScrapeState, FinalizeArmorOutput> {
  public readonly name    = 'finalize:armor';
  public readonly outputs = ['success'] as const;

  public override get outputSchema(): Record<FinalizeArmorOutput, SchemaObjectType> {
    return {
      success: {
        type: 'object',
        properties: {
          output: { type: 'object' },
        },
        required: ['output'],
      },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<FinalizeArmorOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root   = state.getMetadata<CheerioAPI>('aonprdCheerio');
    if (common === undefined || root === undefined) return NodeOutputBuilder.of('success');
    const acc = (state.output ?? {}) as unknown as ArmorOutput;
    const meta = extractArmorMeta(common);
    const assembled = finalizeArmor(common, acc, acc, meta, root);
    setConceptOutput(state, assembled);

    return NodeOutputBuilder.of('success');
  }
}

export const finalizeArmorNode = new FinalizeArmorNode();

export const armorConcept: ConceptDecl<ArmorOutput> = {
  id:       'armor',
  parent:   'entity',
  urlPaths: ['armor', 'shields'],
  capabilities: [
    armorBaseNode,
    armorMechanicsNode,
    finalizeArmorNode,
  ],
};
