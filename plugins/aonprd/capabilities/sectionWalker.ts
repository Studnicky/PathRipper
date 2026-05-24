// Capability: extract:section-walker
// Projects `sections` from `aonprdCommon` (already produced by
// `aonprd:load-and-common`) to a top-level metadata key for downstream nodes
// whose hardRequired declares `sections`.
//
// re-extraction is gone. `extractCommon` is the sole producer of
// the harvested section list; this capability is a pure projection.
import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';
import { CAPABILITY_OUTPUTS } from '../common.js';

import type { ScrapeState }      from '../../../src/state/ScrapeState.js';
import type { RipperServices }   from '../../../src/services/RipperServices.js';
import type { CommonExtraction } from '../common.js';

export type SectionWalkerOutput = 'success' | 'error';

export const sectionWalkerNode: NodeInterface<ScrapeState, SectionWalkerOutput, RipperServices> = {
  name:    'extract:section-walker',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     ['sections'] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: SectionWalkerOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    // Open-world soft-fail when `aonprdCommon` is absent (rule pages).
    if (c === undefined) return { output: 'success' };
    state.setMetadata('sections', c.sections);
    return { output: 'success' };
  },
};
