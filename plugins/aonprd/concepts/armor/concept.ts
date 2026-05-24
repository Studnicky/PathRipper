// Armor concept declaration and capability nodes.

import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState }    from '../../../../src/state/ScrapeState.js';
import type { RipperServices } from '../../../../src/services/RipperServices.js';
import type { ConceptDecl } from '../../taxonomy.js';
import type { CommonExtraction } from '../../common.js';
import { CAPABILITY_OUTPUTS } from '../../common.js';
import { setConceptOutput } from '../_helpers.js';
import type { ArmorOutput, ArmorBaseSlice, ArmorMechanicsSlice, ArmorMetaSlice } from './types.js';
import { extractArmorBase } from './base.js';
import { extractArmorMechanics } from './mechanics.js';
import { extractArmorMeta } from './meta.js';
import { finalizeArmor } from './finalize.js';

export type ArmorBaseOutput = 'success' | 'error';

export const armorBaseNode: NodeInterface<ScrapeState, ArmorBaseOutput, RipperServices> = {
  name:    'extract:armor-base',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: ArmorBaseOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const base = extractArmorBase(c);

    state.output = { ...state.output, ...base };

    return { output: 'success' };
  },
};

export type ArmorMechanicsOutput = 'success' | 'error';

export const armorMechanicsNode: NodeInterface<ScrapeState, ArmorMechanicsOutput, RipperServices> = {
  name:    'extract:armor-mechanics',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: ArmorMechanicsOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const mechanics = extractArmorMechanics(c);

    state.output = { ...state.output, ...mechanics };

    return { output: 'success' };
  },
};

export type FinalizeArmorOutput = 'success';

export const finalizeArmorNode: NodeInterface<ScrapeState, FinalizeArmorOutput, RipperServices> = {
  name:    'finalize:armor',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FinalizeArmorOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $ = state.getMetadata<CheerioAPI>('aonprdCheerio');
    if (c === undefined || $ === undefined) return { output: 'success' };
    const acc = (state.output ?? {}) as unknown as ArmorOutput;
    const meta = extractArmorMeta(c);
    const assembled = finalizeArmor(c, acc, acc, meta, $);
    setConceptOutput(state, assembled);

    return { output: 'success' };
  },
};

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
