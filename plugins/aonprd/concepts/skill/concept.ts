// Skill concept — DAG nodes and concept declaration.
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';
import type { CheerioAPI } from 'cheerio';
import type { ScrapeState }    from '../../../../src/state/ScrapeState.js';
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

class SkillBaseNode extends ScalarNode<ScrapeState, SkillBaseOutput> {
  public readonly name = 'extract:skill-base';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<SkillBaseOutput>> {
    const common  = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root    = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (common === undefined || root === undefined || target === undefined) return NodeOutputBuilder.of('error');

    const base = extractSkillBase(common, root, target);

    state.output = { ...state.output, ...base };

    return NodeOutputBuilder.of('success');
  }
}

export const skillBaseNode = new SkillBaseNode();

// ─────────────────────────────────────────────────────────────────────────────

export type SkillActionsOutput = 'success' | 'error';

class SkillActionsNode extends ScalarNode<ScrapeState, SkillActionsOutput> {
  public readonly name = 'extract:skill-actions';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<SkillActionsOutput>> {
    const common  = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root    = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (common === undefined || root === undefined || target === undefined) return NodeOutputBuilder.of('error');

    const slice = extractSkillActions(common, root, target);

    state.output = { ...state.output, ...slice };

    return NodeOutputBuilder.of('success');
  }
}

export const skillActionsNode = new SkillActionsNode();

// ─────────────────────────────────────────────────────────────────────────────

export type SkillProficiencyTiersOutput = 'success' | 'error';

class SkillProficiencyTiersNode extends ScalarNode<ScrapeState, SkillProficiencyTiersOutput> {
  public readonly name = 'extract:skill-proficiency-tiers';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<SkillProficiencyTiersOutput>> {
    const common  = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root    = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (common === undefined || root === undefined || target === undefined) return NodeOutputBuilder.of('error');

    const slice = extractSkillProficiencyTiers(common, root, target);

    state.output = { ...state.output, ...slice };

    return NodeOutputBuilder.of('success');
  }
}

export const skillProficiencyTiersNode = new SkillProficiencyTiersNode();

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeSkillOutput = 'success';

class FinalizeSkillNode extends ScalarNode<ScrapeState, FinalizeSkillOutput> {
  public readonly name = 'finalize:skill';
  public readonly outputs = ['success'] as const;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<FinalizeSkillOutput>> {
    const common  = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root    = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (common === undefined || root === undefined || target === undefined) return NodeOutputBuilder.of('success');
    const acc = (state.output ?? {}) as unknown as SkillOutput;
    const meta = extractSkillMeta(common, root, target);
    const assembled = finalizeSkill(common, acc, acc, acc, meta);
    setConceptOutput(state, assembled);

    return NodeOutputBuilder.of('success');
  }
}

export const finalizeSkillNode = new FinalizeSkillNode();

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
