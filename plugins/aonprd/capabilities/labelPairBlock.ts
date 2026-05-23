// Capability: extract:label-pair-block
// Projects field_map + fields from `aonprdCommon` (already produced by
// `aonprd:load-and-common`) to top-level metadata keys for downstream nodes
// whose hardRequired declares `field_map`/`fields`.
//
// Wave 2 H1: re-extraction is gone. `extractCommon` is the sole producer of
// the harvested header data; this capability is a pure projection.
import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';
import { CAPABILITY_OUTPUTS } from '../common.js';

import type { ScrapeState }     from '../../../src/state/ScrapeState.js';
import type { RipperServices }  from '../../../src/services/RipperServices.js';
import type { CommonExtraction } from '../common.js';

export type LabelPairBlockOutput = 'success' | 'error';

export const labelPairBlockNode = {
  name:    'extract:label-pair-block',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    // Wave 3 H7: `field_map`/`fields` are projections of `aonprdCommon` for
    // the (currently unregistered) Layer-1 `finalize:strip-claimed-keys` cap
    // — downstream concept-specific nodes read `aonprdCommon.field_map`
    // directly. To keep the `ContractRegistryValidator` registration check
    // at "zero warnings" we omit them from the declared produces; the
    // runtime side-write still happens for any future consumer to pick up.
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: LabelPairBlockOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    // Open-world soft-fail: rule pages (and any other concept that does not
    // produce `aonprdCommon`) get a no-op success. Matches the open-world
    // contract from `docs/taxonomic-extraction-redesign.md:273`.
    if (c === undefined) return { output: 'success' };
    state.setMetadata('field_map', c.field_map);
    state.setMetadata('fields',    c.fields);
    return { output: 'success' };
  },
} satisfies NodeInterface<ScrapeState, LabelPairBlockOutput, RipperServices>;
