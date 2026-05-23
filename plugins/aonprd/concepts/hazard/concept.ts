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
import { extractHazardBase } from './base.js';
import { extractHazardDefenses } from './defenses.js';
import { extractHazardRoutines } from './routines.js';
import { extractHazardReset } from './reset.js';
import { finalizeHazard, finalizeHazardWithSections } from './finalize.js';
import type { HazardOutput } from './types.js';

export type HazardBaseOutput = 'success' | 'error';

export const hazardBaseNode: NodeInterface<ScrapeState, HazardBaseOutput, RipperServices> = {
  name:    'extract:hazard-base',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: HazardBaseOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const base = extractHazardBase(c);

    state.output = { ...state.output, ...base };

    return { output: 'success' };
  },
};

export type HazardDefensesOutput = 'success' | 'error';

export const hazardDefensesNode: NodeInterface<ScrapeState, HazardDefensesOutput, RipperServices> = {
  name:    'extract:hazard-defenses',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: HazardDefensesOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const defenses = extractHazardDefenses(c);

    state.output = { ...state.output, ...defenses };

    return { output: 'success' };
  },
};

export type FinalizeHazardOutput = 'success';

export const finalizeHazardNode: NodeInterface<ScrapeState, FinalizeHazardOutput, RipperServices> = {
  name:    'finalize:hazard',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'sections'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FinalizeHazardOutput }> {
    const c        = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $        = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const sections = state.getMetadata<Section[]>('sections');
    if (c === undefined || $ === undefined || sections === undefined) return { output: 'success' };

    const acc = (state.output ?? {}) as unknown as HazardOutput;
    const defenses = extractHazardDefenses(c);
    const routines = extractHazardRoutines(c);
    const reset    = extractHazardReset(c);
    const assembled = finalizeHazardWithSections(c, acc, defenses, routines, reset, sections, $);
    setConceptOutput(state, assembled);

    return { output: 'success' };
  },
};

export const hazardConcept: ConceptDecl<HazardOutput> = {
  id:       'hazard',
  parent:   'entity',
  urlPaths: ['hazards'],
  capabilities: [
    hazardBaseNode,
    hazardDefensesNode,
    finalizeHazardNode,
  ],
  discriminator: { _type: 'hazard' },
};
