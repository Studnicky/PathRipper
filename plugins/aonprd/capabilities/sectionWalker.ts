// Capability: extract:section-walker
// Projects `sections` from `aonprdCommon` (already produced by
// `aonprd:load-and-common`) to a top-level metadata key for downstream nodes
// whose hardRequired declares `sections`.
//
// re-extraction is gone. `extractCommon` is the sole producer of
// the harvested section list; this capability is a pure projection.
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';
import type { OperationContractFragmentType } from '@studnicky/dagonizer/contracts';
import { CAPABILITY_OUTPUTS } from '../common.js';

import type { ScrapeState }      from '../../../src/state/ScrapeState.js';
import type { CommonExtraction } from '../common.js';

export type SectionWalkerOutput = 'success' | 'error';

class SectionWalkerNodeImpl extends ScalarNode<ScrapeState, SectionWalkerOutput> {
  public readonly name = 'extract:section-walker';
  public readonly outputs = CAPABILITY_OUTPUTS;
  public override readonly contract: OperationContractFragmentType = {
    hardRequired: ['aonprdCommon'],
    produces:     ['sections'],
  };

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<SectionWalkerOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    // Open-world soft-fail when `aonprdCommon` is absent (rule pages).
    if (common === undefined) return NodeOutputBuilder.of('success');
    state.setMetadata('sections', common.sections);
    return NodeOutputBuilder.of('success');
  }
}
export const sectionWalkerNode = new SectionWalkerNodeImpl();
