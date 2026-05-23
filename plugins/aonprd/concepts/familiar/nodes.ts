// Familiar capability nodes.
import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';
import type { CheerioAPI } from 'cheerio';
import type { ScrapeState } from '../../../../src/state/ScrapeState.js';
import type { RipperServices } from '../../../../src/services/RipperServices.js';
import { CAPABILITY_OUTPUTS } from '../../common.js';
import type { CommonExtraction } from '../../common.js';
import { setConceptOutput } from '../_helpers.js';
import { extractFamiliarBase } from './base.js';
import { extractFamiliarPrerequisites } from './prerequisites.js';
import { extractFamiliarAbilities } from './abilities.js';
import { extractFamiliarMeta } from './meta.js';
import { finalizeFamiliar } from './finalize.js';
import type {
  FamiliarOutput,
  FamiliarBaseSlice,
  FamiliarPrerequisitesSlice,
  FamiliarAbilitiesSlice,
  FamiliarMetaSlice,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────────────

export type FamiliarBaseOutput = 'success' | 'error';

export const familiarBaseNode: NodeInterface<ScrapeState, FamiliarBaseOutput, RipperServices> = {
  name:    'extract:familiar-base',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FamiliarBaseOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const base = extractFamiliarBase(c);

    state.output = { ...state.output, ...base };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type FamiliarPrerequisitesOutput = 'success' | 'error';

export const familiarPrerequisitesNode: NodeInterface<ScrapeState, FamiliarPrerequisitesOutput, RipperServices> = {
  name:    'extract:familiar-prerequisites',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FamiliarPrerequisitesOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const prerequisites = extractFamiliarPrerequisites(c);

    state.output = { ...state.output, ...prerequisites };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeFamiliarOutput = 'success';

export const finalizeFamiliarNode: NodeInterface<ScrapeState, FinalizeFamiliarOutput, RipperServices> = {
  name:    'finalize:familiar',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FinalizeFamiliarOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $ = state.getMetadata<CheerioAPI>('aonprdCheerio');
    if (c === undefined || $ === undefined) return { output: 'success' };
    const acc = (state.output ?? {}) as unknown as FamiliarOutput;
    const abilities = extractFamiliarAbilities(c);
    const meta      = extractFamiliarMeta(c);
    const assembled = finalizeFamiliar(c, acc, acc, abilities, meta, $);
    setConceptOutput(state, assembled);

    return { output: 'success' };
  },
};
