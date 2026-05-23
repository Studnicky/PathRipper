// Deity concept — Phase 6.4 taxonomic extraction.
//
// Delegates to Wave 5 slice helpers in deity.ts for correctness.
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

import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState }    from '../../../../src/state/ScrapeState.js';
import type { RipperServices } from '../../../../src/services/RipperServices.js';
import type { ConceptDecl } from '../../taxonomy.js';
import type { CommonExtraction, CheerioNode } from '../../common.js';
import { CAPABILITY_OUTPUTS } from '../../common.js';
import { setConceptOutput } from '../_helpers.js';
import { extractDeityBase } from './base.js';
import { extractDeityDevoteeBenefits } from './devotee-benefits.js';
import { extractDeityEdictsAnathema } from './edicts-anathema.js';
import { extractDeityClericSpells } from './cleric-spells.js';
import { extractDeityRelationships } from './relationships.js';
import { finalizeDeity } from './finalize.js';
import type { DeityOutput, DeityMetaSlice } from './types.js';

// ─── Meta slice extraction ────────────────────────────────────────────────────

function extractDeityMeta(_c: CommonExtraction): DeityMetaSlice {
  return { __deity_meta_marked: true };
}

// ─── Capability nodes ─────────────────────────────────────────────────────────

// Node: extract:deity-base
// Identity + header scalars + sources.

export type DeityBaseOutput = 'success' | 'error';

export const deityBaseNode: NodeInterface<ScrapeState, DeityBaseOutput, RipperServices> = {
  name:    'extract:deity-base',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: DeityBaseOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const base = extractDeityBase(c);

    state.output = { ...state.output, ...base };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

// Node: extract:deity-devotee-benefits
// Divine attribute, font, sanctification, skill, favored weapon, domains,
// alternate domains — from the Devotee Benefits section body.

export type DeityDevoteeBenefitsOutput = 'success' | 'error';

export const deityDevoteeBenefitsNode: NodeInterface<ScrapeState, DeityDevoteeBenefitsOutput, RipperServices> = {
  name:    'extract:deity-devotee-benefits',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: DeityDevoteeBenefitsOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const devotee = extractDeityDevoteeBenefits(c);

    state.output = { ...state.output, ...devotee };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

// Node: extract:deity-edicts-anathema
// Edicts, anathema, areas of concern, follower alignments, category, religious
// symbol, sacred animal, sacred colors, pantheons/covenants — from body prose.

export type DeityEdictsAnathemaOutput = 'success' | 'error';

export const deityEdictsAnathemaNode: NodeInterface<ScrapeState, DeityEdictsAnathemaOutput, RipperServices> = {
  name:    'extract:deity-edicts-anathema',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: DeityEdictsAnathemaOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const edicts = extractDeityEdictsAnathema(c);

    state.output = { ...state.output, ...edicts };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

// Node: extract:deity-cleric-spells
// Cleric Spells rank list + Divine Intercession boon/curse entries.

export type DeityClericSpellsOutput = 'success' | 'error';

export const deityClericSpellsNode: NodeInterface<ScrapeState, DeityClericSpellsOutput, RipperServices> = {
  name:    'extract:deity-cleric-spells',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: DeityClericSpellsOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const spells = extractDeityClericSpells(c);

    state.output = { ...state.output, ...spells };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

// Node: extract:deity-relationships
// Linked Deities.aspx cross-references harvested from body prose.

export type DeityRelationshipsOutput = 'success' | 'error';

export const deityRelationshipsNode: NodeInterface<ScrapeState, DeityRelationshipsOutput, RipperServices> = {
  name:    'extract:deity-relationships',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: DeityRelationshipsOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const rels = extractDeityRelationships(c);

    state.output = { ...state.output, ...rels };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

// Node: finalize:deity
// Assembles complete DeityOutput from all slices, strips claimed field-map keys,
// attaches sections, links, body_text/html, and meta tags.

export type FinalizeDeityOutput = 'success';

export const finalizeDeityNode: NodeInterface<ScrapeState, FinalizeDeityOutput, RipperServices> = {
  name:    'finalize:deity',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'aonprdTarget'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FinalizeDeityOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined || target === undefined) return { output: 'success' };
    const acc = (state.output ?? {}) as unknown as DeityOutput;
    const assembled = finalizeDeity(c, (acc as never), (acc as never), (acc as never), (acc as never), (acc as never), (acc as never), $, target);
    setConceptOutput(state, assembled);

    return { output: 'success' };
  },
};

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
  discriminator: { _type: 'deity' },
};
