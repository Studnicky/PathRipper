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
import { extractTraitBase } from './base.js';
import { finalizeTraitWithSections } from './finalize.js';
import type { TraitOutput } from './types.js';

export type TraitBaseOutput = 'success' | 'error';

class TraitBaseNode extends ScalarNode<ScrapeState, TraitBaseOutput> {
  public readonly name    = 'extract:trait-base';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<TraitBaseOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const base = extractTraitBase(common);

    state.output = { ...state.output, ...base };

    return NodeOutputBuilder.of('success');
  }
}

export const traitBaseNode = new TraitBaseNode();

export type FinalizeTraitOutput = 'success';

class FinalizeTraitNode extends ScalarNode<ScrapeState, FinalizeTraitOutput> {
  public readonly name    = 'finalize:trait';
  public readonly outputs = ['success'] as const;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<FinalizeTraitOutput>> {
    const common   = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root     = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const sections = state.getMetadata<Section[]>('sections');
    if (common === undefined || root === undefined || sections === undefined) return NodeOutputBuilder.of('success');

    const acc = (state.output ?? {}) as unknown as TraitOutput;
    const assembled = finalizeTraitWithSections(common, acc, sections, root);
    setConceptOutput(state, assembled);

    return NodeOutputBuilder.of('success');
  }
}

export const finalizeTraitNode = new FinalizeTraitNode();

export const traitConcept: ConceptDecl<TraitOutput> = {
  id:       'trait',
  parent:   'entity',
  urlPaths: ['traits'],
  capabilities: [
    traitBaseNode,
    finalizeTraitNode,
  ],
};
