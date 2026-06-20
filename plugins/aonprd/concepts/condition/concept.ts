import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState }    from '../../../../src/state/ScrapeState.js';
import type { ConceptDecl } from '../../taxonomy.js';
import {
  CAPABILITY_OUTPUTS,
  type CommonExtraction,
  type Section,
} from '../../common.js';
import { setConceptOutput } from '../_helpers.js';
import { extractConditionBase } from './base.js';
import { extractConditionStagesHelper } from './helpers.js';
import { finalizeConditionWithSections } from './finalize.js';
import type { ConditionOutput } from './types.js';

export type ConditionBaseOutput = 'success' | 'error';

class ConditionBaseNode extends ScalarNode<ScrapeState, ConditionBaseOutput> {
  public readonly name = 'extract:condition-base';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<ConditionBaseOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const base   = extractConditionBase(common);
    const stages = extractConditionStagesHelper(common);

    state.output = state.output !== null
      ? { ...state.output, ...base, ...stages }
      : { ...base, ...stages };

    return NodeOutputBuilder.of('success');
  }
}

export const conditionBaseNode = new ConditionBaseNode();

export type FinalizeConditionOutput = 'success';

class FinalizeConditionNode extends ScalarNode<ScrapeState, FinalizeConditionOutput> {
  public readonly name = 'finalize:condition';
  public readonly outputs = ['success'] as const;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<FinalizeConditionOutput>> {
    const common   = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root     = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const sections = state.getMetadata<Section[]>('sections');
    if (common === undefined || root === undefined || sections === undefined) return NodeOutputBuilder.of('success');

    const acc = (state.output ?? {}) as unknown as ConditionOutput;
    const stages = extractConditionStagesHelper(common);
    const assembled = finalizeConditionWithSections(common, acc as never, stages, sections, root);
    setConceptOutput(state, assembled);

    return NodeOutputBuilder.of('success');
  }
}

export const finalizeConditionNode = new FinalizeConditionNode();

export const conditionConcept: ConceptDecl<ConditionOutput> = {
  id:       'condition',
  parent:   'entity',
  urlPaths: ['conditions'],
  capabilities: [
    conditionBaseNode,
    finalizeConditionNode,
  ],
};
