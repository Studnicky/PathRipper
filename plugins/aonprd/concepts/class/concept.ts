// Class concept — Phase 6.4 taxonomic extraction.

import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState }    from '../../../../src/state/ScrapeState.js';
import type { RipperServices } from '../../../../src/services/RipperServices.js';
import type { ConceptDecl } from '../../taxonomy.js';
import type { CommonExtraction, CheerioNode } from '../../common.js';
import { CAPABILITY_OUTPUTS } from '../../common.js';
import { setConceptOutput } from '../_helpers.js';
import { extractClassBase } from './base.js';
import { extractClassProgression } from './progression.js';
import { extractClassSubclasses } from './subclasses.js';
import { finalizeClass } from './finalize.js';
import type { ClassOutput, ClassMetaSlice } from './types.js';

// ─── Meta slice extraction ────────────────────────────────────────────────────

function extractClassMeta(c: CommonExtraction): ClassMetaSlice {
  return { sections: c.sections };
}

// ─── Capability nodes ─────────────────────────────────────────────────────────

// Node: extract:class-base

export type ClassBaseOutput = 'success' | 'error';

export const classBaseNode: NodeInterface<ScrapeState, ClassBaseOutput, RipperServices> = {
  name:    'extract:class-base',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'aonprdTarget'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: ClassBaseOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined || target === undefined) return { output: 'error' };

    const base = extractClassBase(c, $, target);

    state.output = { ...state.output, ...base };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

// Node: extract:class-progression

export type ClassProgressionOutput = 'success' | 'error';

export const classProgressionNode: NodeInterface<ScrapeState, ClassProgressionOutput, RipperServices> = {
  name:    'extract:class-progression',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: ClassProgressionOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const slice = extractClassProgression(c);

    state.output = { ...state.output, ...slice };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

// Node: extract:class-subclasses

export type ClassSubclassesOutput = 'success' | 'error';

export const classSubclassesNode: NodeInterface<ScrapeState, ClassSubclassesOutput, RipperServices> = {
  name:    'extract:class-subclasses',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: ClassSubclassesOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const slice = extractClassSubclasses(c);

    state.output = { ...state.output, ...slice };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

// Node: finalize:class

export type FinalizeClassOutput = 'success';

export const finalizeClassNode: NodeInterface<ScrapeState, FinalizeClassOutput, RipperServices> = {
  name:    'finalize:class',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'aonprdTarget'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FinalizeClassOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined || target === undefined) return { output: 'success' };

    const meta        = { sections: c.sections };
    const acc = (state.output ?? {}) as unknown as ClassOutput;
    const assembled = finalizeClass(c, acc, acc, acc, meta, $);
    setConceptOutput(state, assembled);

    return { output: 'success' };
  },
};

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
  discriminator: { _type: 'class' },
};
