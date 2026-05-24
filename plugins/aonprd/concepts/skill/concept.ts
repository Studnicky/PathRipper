// Skill concept — DAG nodes and concept declaration.
import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';
import type { CheerioAPI } from 'cheerio';
import type { ScrapeState }    from '../../../../src/state/ScrapeState.js';
import type { RipperServices } from '../../../../src/services/RipperServices.js';
import type { ConceptDecl } from '../../taxonomy.js';
import type { CommonExtraction, CheerioNode } from '../../common.js';
import { CAPABILITY_OUTPUTS } from '../../common.js';
import { setConceptOutput } from '../_helpers.js';
import { extractSkillBase } from './base.js';
import { extractSkillActions } from './actions.js';
import { extractSkillProficiencyTiers } from './proficiency-tiers.js';
import { extractSkillMeta, finalizeSkill } from './finalize.js';
import type { SkillOutput } from './types.js';

// Re-export output types for tests
export type SkillBaseOutput = 'success' | 'error';

export const skillBaseNode: NodeInterface<ScrapeState, SkillBaseOutput, RipperServices> = {
  name:    'extract:skill-base',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'aonprdTarget'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: SkillBaseOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined || target === undefined) return { output: 'error' };

    const base = extractSkillBase(c, $, target);

    state.output = { ...state.output, ...base };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type SkillActionsOutput = 'success' | 'error';

export const skillActionsNode: NodeInterface<ScrapeState, SkillActionsOutput, RipperServices> = {
  name:    'extract:skill-actions',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'aonprdTarget'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: SkillActionsOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined || target === undefined) return { output: 'error' };

    const slice = extractSkillActions(c, $, target);

    state.output = { ...state.output, ...slice };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type SkillProficiencyTiersOutput = 'success' | 'error';

export const skillProficiencyTiersNode: NodeInterface<ScrapeState, SkillProficiencyTiersOutput, RipperServices> = {
  name:    'extract:skill-proficiency-tiers',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'aonprdTarget'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: SkillProficiencyTiersOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined || target === undefined) return { output: 'error' };

    const slice = extractSkillProficiencyTiers(c, $, target);

    state.output = { ...state.output, ...slice };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeSkillOutput = 'success';

export const finalizeSkillNode: NodeInterface<ScrapeState, FinalizeSkillOutput, RipperServices> = {
  name:    'finalize:skill',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'aonprdTarget'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FinalizeSkillOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined || target === undefined) return { output: 'success' };
    const acc = (state.output ?? {}) as unknown as SkillOutput;
    const meta = extractSkillMeta(c, $, target);
    const assembled = finalizeSkill(c, acc, acc, acc, meta);
    setConceptOutput(state, assembled);

    return { output: 'success' };
  },
};

// ─── ConceptDecl export ───────────────────────────────────────────────────────

/**
 * Skill concept declaration for the AONPRD taxonomy.
 * Imported by `plugins/aonprd/taxonomy/aonprd.ts`.
 */
export const skillConcept: ConceptDecl<SkillOutput> = {
  id:       'skill',
  parent:   'entity',
  urlPaths: ['skills'],
  capabilities: [
    skillBaseNode,
    skillActionsNode,
    skillProficiencyTiersNode,
    finalizeSkillNode,
  ],
};
