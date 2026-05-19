// Node: aonprd:extract-generic
// Handles generic, deity, and archetype page types — all collapse to extractGeneric().
import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContract } from '@noocodex/dagonizer/contracts';

import type { ScrapeState }                   from '../../../src/state/ScrapeState.js';
import type { RipperServices }                   from '../../../src/services/RipperServices.js';
import type { CheerioAPI }                    from 'cheerio';
import type { CommonExtraction, CheerioNode } from '../common.js';
import { extractGeneric }                     from '../world.js';

export const extractGenericNode: NodeInterface<ScrapeState, 'success' | 'error', RipperServices> = {
  name:    'aonprd:extract-generic',
  outputs: ['success', 'error'],

  async execute(
    state:    ScrapeState,
    _context: NodeContextInterface<RipperServices>,
  ): Promise<{ output: 'success' | 'error' }> {
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if ($ === undefined || common === undefined || target === undefined) return { output: 'error' };
    state.output = extractGeneric(common, $, target) as unknown as Record<string, unknown>;
    return { output: 'success' };
  },
};

/** OperationContract for extractGenericContract: reads page.html metadata, produces output. */
export const extractGenericContract: OperationContract = {
  name:         'aonprd:extract-generic',
  hardRequired: ['page.html'],
  produces:     ['output'],
  outputs:      ['success', 'error'],
};
