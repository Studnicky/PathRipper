//
// Deity pages have rich structure: five decomposed slices plus a finalize step.
//
// Per-slice:
//   extract:deity-base             — identity + header scalars + sources
//   extract:deity-devotee-benefits — divine attribute, font, sanctification,
//                                    skill, favored weapon, domains, alt domains
//   extract:deity-edicts-anathema  — edicts, anathema, areas of concern,
//                                    follower alignments, category, religious
//                                    symbol, sacred animal/colors, pantheons
//   extract:deity-cleric-spells    — Cleric Spells rank list + intercessions
//   extract:deity-relationships    — linked deity cross-references from body prose
//   finalize:deity                 — assemble + strip raw_fields, attach meta

import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState }    from '../../../../src/state/ScrapeState.js';
import type { ConceptDecl } from '../../../../src/types/Taxonomy.js';
import type { CommonExtraction, CheerioNode } from '../../common.js';
import { CAPABILITY_OUTPUTS } from '../../common.js';
import { setConceptOutput } from '../_helpers.js';
import { extractDeityBase } from './base.js';
import { extractDeityDevoteeBenefits } from './devotee-benefits.js';
import { extractDeityEdictsAnathema } from './edicts-anathema.js';
import { extractDeityClericSpells } from './cleric-spells.js';
import { extractDeityRelationships } from './relationships.js';
import { finalizeDeity } from './finalize.js';
import type { DeityOutput } from './types.js';

// ─── Capability nodes ─────────────────────────────────────────────────────────

// Node: extract:deity-base
// Identity + header scalars + sources.

export type DeityBaseOutput = 'success' | 'error';

class DeityBaseNodeImpl extends ScalarNode<ScrapeState, DeityBaseOutput> {
  public readonly name = 'extract:deity-base';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<DeityBaseOutput, SchemaObjectType> {
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
  ): Promise<NodeOutputType<DeityBaseOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const base = extractDeityBase(common);

    state.output = { ...state.output, ...base };

    return NodeOutputBuilder.of('success');
  }
}
export const deityBaseNode = new DeityBaseNodeImpl();

// ─────────────────────────────────────────────────────────────────────────────

// Node: extract:deity-devotee-benefits
// Divine attribute, font, sanctification, skill, favored weapon, domains,
// alternate domains — from the Devotee Benefits section body.

export type DeityDevoteeBenefitsOutput = 'success' | 'error';

class DeityDevoteeBenefitsNodeImpl extends ScalarNode<ScrapeState, DeityDevoteeBenefitsOutput> {
  public readonly name = 'extract:deity-devotee-benefits';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<DeityDevoteeBenefitsOutput, SchemaObjectType> {
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
  ): Promise<NodeOutputType<DeityDevoteeBenefitsOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const devotee = extractDeityDevoteeBenefits(common);

    state.output = { ...state.output, ...devotee };

    return NodeOutputBuilder.of('success');
  }
}
export const deityDevoteeBenefitsNode = new DeityDevoteeBenefitsNodeImpl();

// ─────────────────────────────────────────────────────────────────────────────

// Node: extract:deity-edicts-anathema
// Edicts, anathema, areas of concern, follower alignments, category, religious
// symbol, sacred animal, sacred colors, pantheons/covenants — from body prose.

export type DeityEdictsAnathemaOutput = 'success' | 'error';

class DeityEdictsAnathemaNodeImpl extends ScalarNode<ScrapeState, DeityEdictsAnathemaOutput> {
  public readonly name = 'extract:deity-edicts-anathema';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<DeityEdictsAnathemaOutput, SchemaObjectType> {
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
  ): Promise<NodeOutputType<DeityEdictsAnathemaOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const edicts = extractDeityEdictsAnathema(common);

    state.output = { ...state.output, ...edicts };

    return NodeOutputBuilder.of('success');
  }
}
export const deityEdictsAnathemaNode = new DeityEdictsAnathemaNodeImpl();

// ─────────────────────────────────────────────────────────────────────────────

// Node: extract:deity-cleric-spells
// Cleric Spells rank list + Divine Intercession boon/curse entries.

export type DeityClericSpellsOutput = 'success' | 'error';

class DeityClericSpellsNodeImpl extends ScalarNode<ScrapeState, DeityClericSpellsOutput> {
  public readonly name = 'extract:deity-cleric-spells';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<DeityClericSpellsOutput, SchemaObjectType> {
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
  ): Promise<NodeOutputType<DeityClericSpellsOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const spells = extractDeityClericSpells(common);

    state.output = { ...state.output, ...spells };

    return NodeOutputBuilder.of('success');
  }
}
export const deityClericSpellsNode = new DeityClericSpellsNodeImpl();

// ─────────────────────────────────────────────────────────────────────────────

// Node: extract:deity-relationships
// Linked Deities.aspx cross-references harvested from body prose.

export type DeityRelationshipsOutput = 'success' | 'error';

class DeityRelationshipsNodeImpl extends ScalarNode<ScrapeState, DeityRelationshipsOutput> {
  public readonly name = 'extract:deity-relationships';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<DeityRelationshipsOutput, SchemaObjectType> {
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
  ): Promise<NodeOutputType<DeityRelationshipsOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const rels = extractDeityRelationships(common);

    state.output = { ...state.output, ...rels };

    return NodeOutputBuilder.of('success');
  }
}
export const deityRelationshipsNode = new DeityRelationshipsNodeImpl();

// ─────────────────────────────────────────────────────────────────────────────

// Node: finalize:deity
// Assembles complete DeityOutput from all slices, strips claimed field-map keys,
// attaches sections, links, body_text/html, and meta tags.

export type FinalizeDeityOutput = 'success';

class FinalizeDeityNodeImpl extends ScalarNode<ScrapeState, FinalizeDeityOutput> {
  public readonly name = 'finalize:deity';
  public readonly outputs = ['success'] as const;

  public override get outputSchema(): Record<FinalizeDeityOutput, SchemaObjectType> {
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
  ): Promise<NodeOutputType<FinalizeDeityOutput>> {
    const common  = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root    = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target  = state.getMetadata<CheerioNode>('aonprdTarget');
    if (common === undefined || root === undefined || target === undefined) return NodeOutputBuilder.of('success');
    const acc = (state.output ?? {}) as unknown as DeityOutput;
    const assembled = finalizeDeity(common, (acc as never), (acc as never), (acc as never), (acc as never), (acc as never), (acc as never), root, target);
    setConceptOutput(state, assembled);

    return NodeOutputBuilder.of('success');
  }
}
export const finalizeDeityNode = new FinalizeDeityNodeImpl();

// ─── ConceptDecl export ───────────────────────────────────────────────────────

/**
 * Deity concept declaration for the AONPRD taxonomy.
 * Imported by `plugins/aonprd/taxonomy/aonprd.ts`.
 *
 * The five extract nodes run in order — base → devotee-benefits →
 * edicts-anathema → cleric-spells → relationships — building up state.output
 * incrementally. The finalize node then recomputes the full output from scratch
 * (re-calling all slice helpers) so that raw_fields sees the complete picture
 * of claimed labels.
 */
export const deityConcept: ConceptDecl<DeityOutput> = {
  id:       'deity',
  parent:   'entity',
  urlPaths: ['deities'],
  capabilities: [
    deityBaseNode,
    deityDevoteeBenefitsNode,
    deityEdictsAnathemaNode,
    deityClericSpellsNode,
    deityRelationshipsNode,
    finalizeDeityNode,
  ],
};
