// Capability: extract:section-walker
// Projects `sections` from `aonprdCommon` (already produced by
// `aonprd:load-and-common`) to a top-level metadata key for downstream nodes
// whose hardRequired declares `sections`.
//
// re-extraction is gone. `extractCommon` is the sole producer of
// the harvested section list; this capability is a pure projection.
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';
import { CAPABILITY_OUTPUTS } from '../common.js';

import type { ScrapeState }      from '../../../src/state/ScrapeState.js';
import type { CommonExtraction } from '../common.js';

export type SectionWalkerOutput = 'success' | 'error';

class SectionWalkerNodeImpl extends ScalarNode<ScrapeState, SectionWalkerOutput> {
  public readonly name = 'extract:section-walker';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<SectionWalkerOutput, SchemaObjectType> {
    return {
      // `success` — writes `sections` metadata key: Section[] (array of {heading,level,body_html,body_text,links}).
      // No state.output delta; soft-fails to success with no writes when `aonprdCommon` is absent.
      success: { type: 'object' },
      // `error` — never emitted (open-world soft-fail to success); no state delta.
      error: { type: 'object' },
    };
  }

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
