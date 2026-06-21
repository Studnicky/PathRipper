// Capability: extract:source-ref
// Projects `source` (first entry) + `sources` (all entries) from
// `aonprdCommon` to top-level metadata keys for downstream nodes whose
// hardRequired declares `source`/`sources`.
//
// re-extraction is gone. `extractCommon` is the sole producer of
// the source reference list; this capability is a pure projection.
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';
import { CAPABILITY_OUTPUTS } from '../common.js';

import type { ScrapeState }      from '../../../src/state/ScrapeState.js';
import type { CommonExtraction } from '../common.js';

export type SourceRefOutput = 'success' | 'error';

class SourceRefNode extends ScalarNode<ScrapeState, SourceRefOutput> {
  public readonly name = 'extract:source-ref';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<SourceRefOutput, SchemaObjectType> {
    return {
      // `success` — writes `sources` (SourceRef[]) and `source` ({ book, page, source_id }) metadata keys.
      // No state.output delta; soft-fails to success with no writes when `aonprdCommon` is absent.
      success: { type: 'object' },
      // `error` — never emitted (open-world soft-fail to success); no state delta.
      error: { type: 'object' },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<SourceRefOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    // Open-world soft-fail when `aonprdCommon` is absent (rule pages).
    if (common === undefined) return NodeOutputBuilder.of('success');
    state.setMetadata('sources', common.sources);
    state.setMetadata('source',  common.source);
    return NodeOutputBuilder.of('success');
  }
}

export const sourceRefNode = new SourceRefNode();
