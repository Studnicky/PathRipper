// Capability: extract:label-pair-block
// Projects field_map + fields from `aonprdCommon` (already produced by
// `aonprd:load-and-common`) to top-level metadata keys for downstream nodes
// whose hardRequired declares `field_map`/`fields`.
//
// re-extraction is gone. `extractCommon` is the sole producer of
// the harvested header data; this capability is a pure projection.
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';
import { CAPABILITY_OUTPUTS } from '../common.js';

import type { ScrapeState }     from '../../../src/state/ScrapeState.js';
import type { CommonExtraction } from '../common.js';

export type LabelPairBlockOutput = 'success' | 'error';

class LabelPairBlockNode extends ScalarNode<ScrapeState, LabelPairBlockOutput> {
  public readonly name = 'extract:label-pair-block';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<LabelPairBlockOutput, SchemaObjectType> {
    return {
      // `success` — writes `field_map` (Record<string,string>) and `fields` (string[]) to metadata.
      // No state.output delta; metadata keys 'field_map' and 'fields' are set.
      success: { type: 'object' },
      // `error` — never emitted (open-world soft-fail to success); no state delta.
      error: { type: 'object' },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<LabelPairBlockOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    // Open-world soft-fail: rule pages (and any other concept that does not
    // produce `aonprdCommon`) get a no-op success. Matches the open-world
    // contract from `docs/taxonomic-extraction-redesign.md:273`.
    if (common === undefined) return NodeOutputBuilder.of('success');
    state.setMetadata('field_map', common.field_map);
    state.setMetadata('fields',    common.fields);
    return NodeOutputBuilder.of('success');
  }
}

export const labelPairBlockNode = new LabelPairBlockNode();
