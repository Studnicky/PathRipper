
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState }    from '../../../../src/state/ScrapeState.js';
import type { ConceptDecl } from '../../../../src/taxonomy/Taxonomy.js';
import type { CommonExtraction, CheerioNode } from '../../common.js';
import { CAPABILITY_OUTPUTS } from '../../common.js';
import { setConceptOutput } from '../_helpers.js';
import { extractClassBase } from './base.js';
import { extractClassProgression } from './progression.js';
import { extractClassSubclasses } from './subclasses.js';
import { finalizeClass } from './finalize.js';
import type { ClassOutput } from './types.js';

// ─── Capability nodes ─────────────────────────────────────────────────────────

// Node: extract:class-base

export type ClassBaseOutput = 'success' | 'error';

class ClassBaseNode extends ScalarNode<ScrapeState, ClassBaseOutput> {
  public readonly name = 'extract:class-base';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<ClassBaseOutput, SchemaObjectType> {
    return {
      success: {
        type: 'object',
        properties: {
          output: { type: 'object' },
        },
        required: ['output'],
      },
      error: { type: 'object' },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<ClassBaseOutput>> {
    const common  = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root    = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target  = state.getMetadata<CheerioNode>('aonprdTarget');
    if (common === undefined || root === undefined || target === undefined) return NodeOutputBuilder.of('error');

    const base = extractClassBase(common, root, target);

    state.output = { ...state.output, ...base };

    return NodeOutputBuilder.of('success');
  }
}

export const classBaseNode = new ClassBaseNode();

// ─────────────────────────────────────────────────────────────────────────────

// Node: extract:class-progression

export type ClassProgressionOutput = 'success' | 'error';

class ClassProgressionNode extends ScalarNode<ScrapeState, ClassProgressionOutput> {
  public readonly name = 'extract:class-progression';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<ClassProgressionOutput, SchemaObjectType> {
    return {
      success: {
        type: 'object',
        properties: {
          output: { type: 'object' },
        },
        required: ['output'],
      },
      error: { type: 'object' },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<ClassProgressionOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const slice = extractClassProgression(common);

    state.output = { ...state.output, ...slice };

    return NodeOutputBuilder.of('success');
  }
}

export const classProgressionNode = new ClassProgressionNode();

// ─────────────────────────────────────────────────────────────────────────────

// Node: extract:class-subclasses

export type ClassSubclassesOutput = 'success' | 'error';

class ClassSubclassesNode extends ScalarNode<ScrapeState, ClassSubclassesOutput> {
  public readonly name = 'extract:class-subclasses';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<ClassSubclassesOutput, SchemaObjectType> {
    return {
      success: {
        type: 'object',
        properties: {
          output: { type: 'object' },
        },
        required: ['output'],
      },
      error: { type: 'object' },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<ClassSubclassesOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const slice = extractClassSubclasses(common);

    state.output = { ...state.output, ...slice };

    return NodeOutputBuilder.of('success');
  }
}

export const classSubclassesNode = new ClassSubclassesNode();

// ─────────────────────────────────────────────────────────────────────────────

// Node: finalize:class

export type FinalizeClassOutput = 'success';

class FinalizeClassNode extends ScalarNode<ScrapeState, FinalizeClassOutput> {
  public readonly name = 'finalize:class';
  public readonly outputs = ['success'] as const;

  public override get outputSchema(): Record<FinalizeClassOutput, SchemaObjectType> {
    return {
      success: {
        type: 'object',
        properties: {
          output: { type: 'object' },
        },
        required: ['output'],
      },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<FinalizeClassOutput>> {
    const common  = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root    = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target  = state.getMetadata<CheerioNode>('aonprdTarget');
    if (common === undefined || root === undefined || target === undefined) return NodeOutputBuilder.of('success');

    const meta        = { sections: common.sections };
    const acc = (state.output ?? {}) as unknown as ClassOutput;
    const assembled = finalizeClass(common, acc, acc, acc, meta, root);
    setConceptOutput(state, assembled);

    return NodeOutputBuilder.of('success');
  }
}

export const finalizeClassNode = new FinalizeClassNode();

// ─── ConceptDecl export ───────────────────────────────────────────────────────

export const classConcept: ConceptDecl<ClassOutput> = {
  id:       'class',
  parent:   'entity',
  urlPaths: ['classes'],
  capabilities: [
    classBaseNode,
    classProgressionNode,
    classSubclassesNode,
    finalizeClassNode,
  ],
};
