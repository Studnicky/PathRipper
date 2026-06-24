import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState }    from '../../../../src/state/ScrapeState.js';
import type { ConceptDecl } from '../../../../src/types/Taxonomy.js';
import {
  CAPABILITY_OUTPUTS,
  type CommonExtraction,
  type Section,
} from '../../common.js';
import { setConceptOutput } from '../_helpers.js';
import { extractHazardBase } from './base.js';
import { extractHazardDefenses } from './defenses.js';
import { extractHazardRoutines } from './routines.js';
import { extractHazardReset } from './reset.js';
import { finalizeHazardWithSections } from './finalize.js';
import type { HazardOutput } from './types.js';

export type HazardBaseOutput = 'success' | 'error';

class HazardBaseNode extends ScalarNode<ScrapeState, HazardBaseOutput> {
  public readonly name = 'extract:hazard-base';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<HazardBaseOutput, SchemaObjectType> {
    return {
      // state.output merged with HazardBaseSlice fields
      success: { type: 'object', properties: { output: { type: 'object' } }, required: ['output'] },
      error:   { type: 'object' },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<HazardBaseOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const base = extractHazardBase(common);

    state.output = { ...state.output, ...base };

    return NodeOutputBuilder.of('success');
  }
}

export const hazardBaseNode = new HazardBaseNode();

export type HazardDefensesOutput = 'success' | 'error';

class HazardDefensesNode extends ScalarNode<ScrapeState, HazardDefensesOutput> {
  public readonly name = 'extract:hazard-defenses';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<HazardDefensesOutput, SchemaObjectType> {
    return {
      // state.output merged with HazardDefensesSlice fields
      success: { type: 'object', properties: { output: { type: 'object' } }, required: ['output'] },
      error:   { type: 'object' },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<HazardDefensesOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const defenses = extractHazardDefenses(common);

    state.output = { ...state.output, ...defenses };

    return NodeOutputBuilder.of('success');
  }
}

export const hazardDefensesNode = new HazardDefensesNode();

export type FinalizeHazardOutput = 'success';

class FinalizeHazardNode extends ScalarNode<ScrapeState, FinalizeHazardOutput> {
  public readonly name = 'finalize:hazard';
  public readonly outputs = ['success'] as const;

  public override get outputSchema(): Record<FinalizeHazardOutput, SchemaObjectType> {
    return {
      // setConceptOutput writes fully assembled HazardOutput to state.output
      success: { type: 'object', properties: { output: { type: 'object' } }, required: ['output'] },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<FinalizeHazardOutput>> {
    const common    = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const sections  = state.getMetadata<Section[]>('sections');
    if (common === undefined || root === undefined || sections === undefined) return NodeOutputBuilder.of('success');

    const acc = (state.output ?? {}) as unknown as HazardOutput;
    const defenses = extractHazardDefenses(common);
    const routines = extractHazardRoutines(common);
    const reset    = extractHazardReset(common);
    const assembled = finalizeHazardWithSections(common, acc, defenses, routines, reset, sections, root);
    setConceptOutput(state, assembled);

    return NodeOutputBuilder.of('success');
  }
}

export const finalizeHazardNode = new FinalizeHazardNode();

export const hazardConcept: ConceptDecl<HazardOutput> = {
  id:       'hazard',
  parent:   'entity',
  urlPaths: ['hazards'],
  capabilities: [
    hazardBaseNode,
    hazardDefensesNode,
    finalizeHazardNode,
  ],
};
