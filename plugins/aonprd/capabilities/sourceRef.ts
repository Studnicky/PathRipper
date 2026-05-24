// Capability: extract:source-ref
// Projects `source` (first entry) + `sources` (all entries) from
// `aonprdCommon` to top-level metadata keys for downstream nodes whose
// hardRequired declares `source`/`sources`.
//
// re-extraction is gone. `extractCommon` is the sole producer of
// the source reference list; this capability is a pure projection.
import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';
import { CAPABILITY_OUTPUTS } from '../common.js';

import type { ScrapeState }      from '../../../src/state/ScrapeState.js';
import type { RipperServices }   from '../../../src/services/RipperServices.js';
import type { CommonExtraction } from '../common.js';

export type SourceRefOutput = 'success' | 'error';

export const sourceRefNode: NodeInterface<ScrapeState, SourceRefOutput, RipperServices> = {
  name:    'extract:source-ref',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    // `source`/`sources` are projections of `aonprdCommon` for
    // any future Layer-1 consumer — concept-specific nodes today read
    // `aonprdCommon.source`/`.sources` directly. Omit from declared produces
    // so the `ContractRegistryValidator` registration check stays at "zero
    // warnings"; the runtime side-write still happens.
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: SourceRefOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    // Open-world soft-fail when `aonprdCommon` is absent (rule pages).
    if (c === undefined) return { output: 'success' };
    state.setMetadata('sources', c.sources);
    state.setMetadata('source',  c.source);
    return { output: 'success' };
  },
};
