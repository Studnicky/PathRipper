//
// Wraps extractGeneric, extractCondition, extractTrait, and extractHazard
// helpers in contract-carrying capability nodes.

import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState }    from '../../../../src/state/ScrapeState.js';
import type { ConceptDecl } from '../../taxonomy.js';
import type { CommonExtraction, CheerioNode } from '../../common.js';
import { CAPABILITY_OUTPUTS } from '../../common.js';
import { setConceptOutput } from '../_helpers.js';
import { extractGeneric } from './generic.js';
import type { GenericOutput } from './types.js';

// ─── Capability nodes ─────────────────────────────────────────────────────────

export type GenericExtractOutput = 'success' | 'error';

class GenericExtractNode extends ScalarNode<ScrapeState, GenericExtractOutput> {
  public readonly name    = 'extract:generic';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<GenericExtractOutput>> {
    const common  = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root    = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target  = state.getMetadata<CheerioNode>('aonprdTarget');
    if (common === undefined || root === undefined || target === undefined) return NodeOutputBuilder.of('error');

    const result = extractGeneric(common, root, target);

    setConceptOutput(state, result);

    return NodeOutputBuilder.of('success');
  }
}

export const genericExtractNode = new GenericExtractNode();

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
