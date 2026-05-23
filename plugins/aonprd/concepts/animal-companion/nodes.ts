// Animal-companion capability nodes.
import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';
import type { CheerioAPI } from 'cheerio';
import type { ScrapeState } from '../../../../src/state/ScrapeState.js';
import type { RipperServices } from '../../../../src/services/RipperServices.js';
import { CAPABILITY_OUTPUTS } from '../../common.js';
import type { CommonExtraction, CheerioNode } from '../../common.js';
import { setConceptOutput } from '../_helpers.js';
import { extractAnimalCompanionBase } from './base.js';
import { extractAnimalCompanionStats } from './stats.js';
import { extractAnimalCompanionCombat } from './combat.js';
import { extractAnimalCompanionAdvancement } from './advancement.js';
import { extractAnimalCompanionMeta } from './meta.js';
import { finalizeAnimalCompanion } from './finalize.js';
import type {
  AnimalCompanionOutput,
  AnimalCompanionBaseSlice,
  AnimalCompanionStatsSlice,
  AnimalCompanionCombatSlice,
  AnimalCompanionAdvancementSlice,
  AnimalCompanionMetaSlice,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────────────

export type AnimalCompanionBaseOutput = 'success' | 'error';

export const animalCompanionBaseNode: NodeInterface<ScrapeState, AnimalCompanionBaseOutput, RipperServices> = {
  name:    'extract:animal-companion-base',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdTarget'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: AnimalCompanionBaseOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || target === undefined) return { output: 'error' };

    const base = extractAnimalCompanionBase(c, target);

    state.output = { ...state.output, ...base };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type AnimalCompanionStatsOutput = 'success' | 'error';

export const animalCompanionStatsNode: NodeInterface<ScrapeState, AnimalCompanionStatsOutput, RipperServices> = {
  name:    'extract:animal-companion-stats',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: AnimalCompanionStatsOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const stats = extractAnimalCompanionStats(c);

    state.output = { ...state.output, ...stats };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type AnimalCompanionCombatOutput = 'success' | 'error';

export const animalCompanionCombatNode: NodeInterface<ScrapeState, AnimalCompanionCombatOutput, RipperServices> = {
  name:    'extract:animal-companion-combat',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: AnimalCompanionCombatOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const combat = extractAnimalCompanionCombat(c);

    state.output = { ...state.output, ...combat };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type AnimalCompanionAdvancementOutput = 'success' | 'error';

export const animalCompanionAdvancementNode: NodeInterface<ScrapeState, AnimalCompanionAdvancementOutput, RipperServices> = {
  name:    'extract:animal-companion-advancement',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: AnimalCompanionAdvancementOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const advancement = extractAnimalCompanionAdvancement(c);

    state.output = { ...state.output, ...advancement };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeAnimalCompanionOutput = 'success';

export const finalizeAnimalCompanionNode: NodeInterface<ScrapeState, FinalizeAnimalCompanionOutput, RipperServices> = {
  name:    'finalize:animal-companion',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'aonprdTarget'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FinalizeAnimalCompanionOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined || target === undefined) return { output: 'success' };
    const acc = (state.output ?? {}) as unknown as AnimalCompanionOutput;
    const assembled = finalizeAnimalCompanion(c, (acc as never), (acc as never), (acc as never), (acc as never), (acc as never), $);
    setConceptOutput(state, assembled);

    return { output: 'success' };
  },
};
