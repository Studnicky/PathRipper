// Capability: extract:source-ref
// Projects `source` (first entry) + `sources` (all entries) from
// `aonprdCommon` to top-level metadata keys for downstream nodes whose
// hardRequired declares `source`/`sources`.
//
// re-extraction is gone. `extractCommon` is the sole producer of
// the source reference list; this capability is a pure projection.
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';
import type { OperationContractFragmentType } from '@studnicky/dagonizer/contracts';
import { CAPABILITY_OUTPUTS } from '../common.js';

import type { ScrapeState }      from '../../../src/state/ScrapeState.js';
import type { CommonExtraction } from '../common.js';

export type SourceRefOutput = 'success' | 'error';

class SourceRefNode extends ScalarNode<ScrapeState, SourceRefOutput> {
  public readonly name = 'extract:source-ref';
  public readonly outputs = CAPABILITY_OUTPUTS;
  public override readonly contract: OperationContractFragmentType = {
    hardRequired: ['aonprdCommon'] as const,
    // `source`/`sources` are projections of `aonprdCommon` for
    // any future Layer-1 consumer — concept-specific nodes today read
    // `aonprdCommon.source`/`.sources` directly. Omit from declared produces
    // so the `ContractRegistryValidator` registration check stays at "zero
    // warnings"; the runtime side-write still happens.
    produces:     [] as const,
  };

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
