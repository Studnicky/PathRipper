// Node: aonprd:load-and-common
// Loads cheerio from the raw HTML in state.page.html, runs the shared
// CommonExtraction pipeline, and stashes both the CheerioAPI handle and the
// CommonExtraction result as transient metadata keys for downstream nodes.
import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContract } from '@noocodex/dagonizer/contracts';

import type { ScrapeState }  from '../../../src/state/ScrapeState.js';
import type { RipperServices }  from '../../../src/services/RipperServices.js';
import { loadHtml, extractCommon, findContentSpan } from '../common.js';

export type LoadAndCommonOutput = 'success' | 'error';

export const loadAndCommonNode: NodeInterface<ScrapeState, LoadAndCommonOutput, RipperServices> = {
  name:    'aonprd:load-and-common',
  outputs: ['success', 'error'],

  async execute(
    state:    ScrapeState,
    _context: NodeContextInterface<RipperServices>,
  ): Promise<{ output: LoadAndCommonOutput }> {
    const html = state.page.html;
    if (html === undefined) return { output: 'error' };

    const $ = loadHtml(html);
    const common = extractCommon($, state.page.url);
    if (common === null) return { output: 'error' };

    // Resolve the target span (monster pages nest their statblock in a child span).
    const span = findContentSpan($);
    const target = span !== null && span.find('span.monster-page').first().length > 0
      ? span.find('span.monster-page').first()
      : span;

    // Stash transient values on metadata — not serialized by snapshotData().
    state.setMetadata('aonprdCheerio', $);
    state.setMetadata('aonprdCommon',  common);
    state.setMetadata('aonprdTarget',  target);

    return { output: 'success' };
  },
};

/** OperationContract for loadAndCommonNode: reads page.html, produces aonprd metadata (transient). */
export const loadAndCommonContract: OperationContract = {
  name:         'aonprd:load-and-common',
  hardRequired: ['page.html'],
  produces:     [],
  outputs:      ['success', 'error'],
};
