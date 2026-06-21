// Familiar capability nodes.
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';
import type { CheerioAPI } from 'cheerio';
import type { ScrapeState } from '../../../../src/state/ScrapeState.js';
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
} from './types.js';

// ─────────────────────────────────────────────────────────────────────────────

export type FamiliarBaseOutput = 'success' | 'error';

class FamiliarBaseNode extends ScalarNode<ScrapeState, FamiliarBaseOutput> {
  public readonly name = 'extract:familiar-base';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<FamiliarBaseOutput, SchemaObjectType> {
    return {
      // state.output merged with FamiliarBaseSlice fields
      success: { type: 'object', properties: { output: { type: 'object' } }, required: ['output'] },
      error:   { type: 'object' },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<FamiliarBaseOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const base = extractFamiliarBase(common);

    state.output = { ...state.output, ...base };

    return NodeOutputBuilder.of('success');
  }
}

export const familiarBaseNode = new FamiliarBaseNode();

// ─────────────────────────────────────────────────────────────────────────────

export type FamiliarPrerequisitesOutput = 'success' | 'error';

class FamiliarPrerequisitesNode extends ScalarNode<ScrapeState, FamiliarPrerequisitesOutput> {
  public readonly name = 'extract:familiar-prerequisites';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<FamiliarPrerequisitesOutput, SchemaObjectType> {
    return {
      // state.output merged with FamiliarPrerequisitesSlice fields
      success: { type: 'object', properties: { output: { type: 'object' } }, required: ['output'] },
      error:   { type: 'object' },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<FamiliarPrerequisitesOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const prerequisites = extractFamiliarPrerequisites(common);

    state.output = { ...state.output, ...prerequisites };

    return NodeOutputBuilder.of('success');
  }
}

export const familiarPrerequisitesNode = new FamiliarPrerequisitesNode();

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeFamiliarOutput = 'success';

class FinalizeFamiliarNode extends ScalarNode<ScrapeState, FinalizeFamiliarOutput> {
  public readonly name = 'finalize:familiar';
  public readonly outputs = ['success'] as const;

  public override get outputSchema(): Record<FinalizeFamiliarOutput, SchemaObjectType> {
    return {
      // setConceptOutput writes fully assembled FamiliarOutput to state.output
      success: { type: 'object', properties: { output: { type: 'object' } }, required: ['output'] },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<FinalizeFamiliarOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root   = state.getMetadata<CheerioAPI>('aonprdCheerio');
    if (common === undefined || root === undefined) return NodeOutputBuilder.of('success');
    const acc = (state.output ?? {}) as unknown as FamiliarOutput;
    const abilities = extractFamiliarAbilities(common);
    const meta      = extractFamiliarMeta(common);
    const assembled = finalizeFamiliar(common, acc, acc, abilities, meta, root);
    setConceptOutput(state, assembled);

    return NodeOutputBuilder.of('success');
  }
}

export const finalizeFamiliarNode = new FinalizeFamiliarNode();
