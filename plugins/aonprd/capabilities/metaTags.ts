// Capability: extract:meta-tags
// Reads the parsed `aonprdCheerio` document and projects `<meta>` tag
// content into a structured `aonprdMetaTags` metadata bag. Consumed by
// concept finalize nodes that previously called `extractMetaDescription` +
// `extractMetaKeywords` inline.
//
// Lifted into Layer 1 so the capability runs once per page and every concept
// reads from `aonprdMetaTags` rather than re-implementing extraction inline.
//
// Open-world convention: soft-fail to `'success'` with no writes when
// `aonprdCheerio` is absent (e.g. rule pages whose load short-circuits).
import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState }    from '../../../src/state/ScrapeState.js';
import type { RipperServices } from '../../../src/services/RipperServices.js';
import { extractMetaDescription, extractMetaKeywords } from '../common.js';

/** Structured shape of the `aonprdMetaTags` metadata bag. */
export interface AonprdMetaTags {
  readonly description: string | null;
  readonly keywords:    string | null;
}

export type MetaTagsOutput = 'success';

export const metaTagsNode: NodeInterface<ScrapeState, MetaTagsOutput, RipperServices> = {
  name:    'extract:meta-tags',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCheerio'] as const,
    // `aonprdMetaTags` is consumed via direct `state.getMetadata` reads in
    // concept finalize nodes (open-world side-write convention used by other
    // projection caps like `labelPairBlockNode`). Listing it in `produces`
    // would trip the `ContractRegistryValidator` "dead produces" check
    // because no node declares `hardRequired: ['aonprdMetaTags']`.
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: MetaTagsOutput }> {
    const $ = state.getMetadata<CheerioAPI>('aonprdCheerio');
    if ($ === undefined) return { output: 'success' };
    const meta: AonprdMetaTags = {
      description: extractMetaDescription($),
      keywords:    extractMetaKeywords($),
    };
    state.setMetadata('aonprdMetaTags', meta);
    return { output: 'success' };
  },
};
