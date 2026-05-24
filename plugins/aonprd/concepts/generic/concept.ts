//
// Wraps extractGeneric, extractCondition, extractTrait, and extractHazard
// helpers in contract-carrying capability nodes.

import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState }    from '../../../../src/state/ScrapeState.js';
import type { RipperServices } from '../../../../src/services/RipperServices.js';
import type { ConceptDecl } from '../../taxonomy.js';
import type { CommonExtraction, CheerioNode } from '../../common.js';
import { CAPABILITY_OUTPUTS } from '../../common.js';
import { setConceptOutput } from '../_helpers.js';
import { extractGeneric } from './generic.js';
import type { GenericOutput } from './types.js';

// ─── Capability nodes ─────────────────────────────────────────────────────────

export type GenericExtractOutput = 'success' | 'error';

export const genericExtractNode: NodeInterface<ScrapeState, GenericExtractOutput, RipperServices> = {
  name:    'extract:generic',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'aonprdTarget'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: GenericExtractOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined || target === undefined) return { output: 'error' };

    const result = extractGeneric(c, $, target);

    setConceptOutput(state, result);

    return { output: 'success' };
  },
};

// ─── ConceptDecl export ───────────────────────────────────────────────────────

/**
 * Generic concept declaration for the AONPRD taxonomy.
 *
 * `urlPaths` is intentionally empty — this concept is a fallback, not a
 * direct URL match. The taxonomy router sends unmatched URLs to
 * `aonprd:make-unknown` today. When a future plan adds a generic-fallback
 * annotation, this concept becomes the catch-all instead.
 */
export const genericConcept: ConceptDecl<GenericOutput> = {
  id:           'generic',
  parent:       'thing',
  urlPaths:     [],
  capabilities: [genericExtractNode],
};
