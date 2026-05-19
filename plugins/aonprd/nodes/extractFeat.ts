// Node: aonprd:extract-feat
import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContract } from '@noocodex/dagonizer/contracts';

import type { ScrapeState }                   from '../../../src/state/ScrapeState.js';
import type { RipperServices }                   from '../../../src/services/RipperServices.js';
import type { CheerioAPI }                    from 'cheerio';
import type { CommonExtraction, CheerioNode } from '../common.js';
import { extractFeat }                        from '../feat.js';

export const extractFeatNode: NodeInterface<ScrapeState, 'success' | 'error', RipperServices> = {
  name:    'aonprd:extract-feat',
  outputs: ['success', 'error'],

  async execute(
    state:    ScrapeState,
    _context: NodeContextInterface<RipperServices>,
  ): Promise<{ output: 'success' | 'error' }> {
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if ($ === undefined || common === undefined || target === undefined) return { output: 'error' };
    state.output = extractFeat(common, $, target) as unknown as Record<string, unknown>;
    return { output: 'success' };
  },
};

/** OperationContract for extractFeatContract: reads page.html metadata, produces output. */
export const extractFeatContract: OperationContract = {
  name:         'aonprd:extract-feat',
  hardRequired: ['page.html'],
  produces:     ['output'],
  outputs:      ['success', 'error'],
};
