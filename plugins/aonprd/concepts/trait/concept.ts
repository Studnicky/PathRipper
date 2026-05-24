import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState }    from '../../../../src/state/ScrapeState.js';
import type { RipperServices } from '../../../../src/services/RipperServices.js';
import type { ConceptDecl } from '../../taxonomy.js';
import {
  CAPABILITY_OUTPUTS,
  type CommonExtraction,
  type Section,
  type CheerioNode,
} from '../../common.js';
import { setConceptOutput } from '../_helpers.js';
import { extractTraitBase } from './base.js';
import { finalizeTrait, finalizeTraitWithSections } from './finalize.js';
import type { TraitOutput } from './types.js';

export type TraitBaseOutput = 'success' | 'error';

export const traitBaseNode: NodeInterface<ScrapeState, TraitBaseOutput, RipperServices> = {
  name:    'extract:trait-base',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: TraitBaseOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const base = extractTraitBase(c);

    state.output = { ...state.output, ...base };

    return { output: 'success' };
  },
};

export type FinalizeTraitOutput = 'success';

export const finalizeTraitNode: NodeInterface<ScrapeState, FinalizeTraitOutput, RipperServices> = {
  name:    'finalize:trait',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'sections'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FinalizeTraitOutput }> {
    const c        = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $        = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const sections = state.getMetadata<Section[]>('sections');
    if (c === undefined || $ === undefined || sections === undefined) return { output: 'success' };

    const acc = (state.output ?? {}) as unknown as TraitOutput;
    const assembled = finalizeTraitWithSections(c, acc, sections, $);
    setConceptOutput(state, assembled);

    return { output: 'success' };
  },
};

export const traitConcept: ConceptDecl<TraitOutput> = {
  id:       'trait',
  parent:   'entity',
  urlPaths: ['traits'],
  capabilities: [
    traitBaseNode,
    finalizeTraitNode,
  ],
};
