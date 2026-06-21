// Animal-companion capability nodes.
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';
import type { CheerioAPI } from 'cheerio';
import type { ScrapeState } from '../../../../src/state/ScrapeState.js';
import { CAPABILITY_OUTPUTS } from '../../common.js';
import type { CommonExtraction, CheerioNode } from '../../common.js';
import { setConceptOutput } from '../_helpers.js';
import { extractAnimalCompanionBase } from './base.js';
import { extractAnimalCompanionStats } from './stats.js';
import { extractAnimalCompanionCombat } from './combat.js';
import { extractAnimalCompanionAdvancement } from './advancement.js';
import { finalizeAnimalCompanion } from './finalize.js';
import type {
  AnimalCompanionOutput,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────────────

export type AnimalCompanionBaseOutput = 'success' | 'error';

class AnimalCompanionBaseNode extends ScalarNode<ScrapeState, AnimalCompanionBaseOutput> {
  public readonly name = 'extract:animal-companion-base';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<AnimalCompanionBaseOutput, SchemaObjectType> {
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
  ): Promise<NodeOutputType<AnimalCompanionBaseOutput>> {
    const common  = state.getMetadata<CommonExtraction>('aonprdCommon');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (common === undefined || target === undefined) return NodeOutputBuilder.of('error');

    const base = extractAnimalCompanionBase(common, target);

    state.output = { ...state.output, ...base };

    return NodeOutputBuilder.of('success');
  }
}

export const animalCompanionBaseNode = new AnimalCompanionBaseNode();

// ─────────────────────────────────────────────────────────────────────────────

export type AnimalCompanionStatsOutput = 'success' | 'error';

class AnimalCompanionStatsNode extends ScalarNode<ScrapeState, AnimalCompanionStatsOutput> {
  public readonly name = 'extract:animal-companion-stats';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<AnimalCompanionStatsOutput, SchemaObjectType> {
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
  ): Promise<NodeOutputType<AnimalCompanionStatsOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const stats = extractAnimalCompanionStats(common);

    state.output = { ...state.output, ...stats };

    return NodeOutputBuilder.of('success');
  }
}

export const animalCompanionStatsNode = new AnimalCompanionStatsNode();

// ─────────────────────────────────────────────────────────────────────────────

export type AnimalCompanionCombatOutput = 'success' | 'error';

class AnimalCompanionCombatNode extends ScalarNode<ScrapeState, AnimalCompanionCombatOutput> {
  public readonly name = 'extract:animal-companion-combat';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<AnimalCompanionCombatOutput, SchemaObjectType> {
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
  ): Promise<NodeOutputType<AnimalCompanionCombatOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const combat = extractAnimalCompanionCombat(common);

    state.output = { ...state.output, ...combat };

    return NodeOutputBuilder.of('success');
  }
}

export const animalCompanionCombatNode = new AnimalCompanionCombatNode();

// ─────────────────────────────────────────────────────────────────────────────

export type AnimalCompanionAdvancementOutput = 'success' | 'error';

class AnimalCompanionAdvancementNode extends ScalarNode<ScrapeState, AnimalCompanionAdvancementOutput> {
  public readonly name = 'extract:animal-companion-advancement';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<AnimalCompanionAdvancementOutput, SchemaObjectType> {
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
  ): Promise<NodeOutputType<AnimalCompanionAdvancementOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const advancement = extractAnimalCompanionAdvancement(common);

    state.output = { ...state.output, ...advancement };

    return NodeOutputBuilder.of('success');
  }
}

export const animalCompanionAdvancementNode = new AnimalCompanionAdvancementNode();

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeAnimalCompanionOutput = 'success';

class FinalizeAnimalCompanionNode extends ScalarNode<ScrapeState, FinalizeAnimalCompanionOutput> {
  public readonly name = 'finalize:animal-companion';
  public readonly outputs = ['success'] as const;

  public override get outputSchema(): Record<FinalizeAnimalCompanionOutput, SchemaObjectType> {
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
  ): Promise<NodeOutputType<FinalizeAnimalCompanionOutput>> {
    const common  = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root    = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (common === undefined || root === undefined || target === undefined) return NodeOutputBuilder.of('success');
    const acc = (state.output ?? {}) as unknown as AnimalCompanionOutput;
    const assembled = finalizeAnimalCompanion(common, (acc as never), (acc as never), (acc as never), (acc as never), (acc as never), root);
    setConceptOutput(state, assembled);

    return NodeOutputBuilder.of('success');
  }
}

export const finalizeAnimalCompanionNode = new FinalizeAnimalCompanionNode();
