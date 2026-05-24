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
import { extractConditionBase } from './base.js';
import { extractConditionStagesHelper } from './helpers.js';
import { finalizeCondition, finalizeConditionWithSections } from './finalize.js';
import type { ConditionOutput } from './types.js';

export type ConditionBaseOutput = 'success' | 'error';

export const conditionBaseNode: NodeInterface<ScrapeState, ConditionBaseOutput, RipperServices> = {
  name:    'extract:condition-base',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: ConditionBaseOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const base   = extractConditionBase(c);
    const stages = extractConditionStagesHelper(c);

    state.output = state.output !== null
      ? { ...state.output, ...base, ...stages }
      : { ...base, ...stages };

    return { output: 'success' };
  },
};

export type FinalizeConditionOutput = 'success';

export const finalizeConditionNode: NodeInterface<ScrapeState, FinalizeConditionOutput, RipperServices> = {
  name:    'finalize:condition',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'sections'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FinalizeConditionOutput }> {
    const c        = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $        = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const sections = state.getMetadata<Section[]>('sections');
    if (c === undefined || $ === undefined || sections === undefined) return { output: 'success' };

    const acc = (state.output ?? {}) as unknown as ConditionOutput;
    const stages = extractConditionStagesHelper(c);
    const assembled = finalizeConditionWithSections(c, acc as never, stages, sections, $);
    setConceptOutput(state, assembled);

    return { output: 'success' };
  },
};

export const conditionConcept: ConceptDecl<ConditionOutput> = {
  id:       'condition',
  parent:   'entity',
  urlPaths: ['conditions'],
  capabilities: [
    conditionBaseNode,
    finalizeConditionNode,
  ],
};
