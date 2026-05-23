// Sample concept for the `_test_secondary` plugin — Wave 5 proof-of-concept.
//
// Single concept that proves the AONPRD Layer-1 capabilities binary
// (`sectionWalkerNode`, `sourceRefNode`, `labelPairBlockNode`, `metaTagsNode`)
// can be reused with a non-AON strategy. The finalize node reads the
// projected `aonprdCommon.sections` / `.sources` that the secondary strategy
// populated and emits a minimal output shape.
import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';

import type { ScrapeState }    from '../../../src/state/ScrapeState.js';
import type { RipperServices } from '../../../src/services/RipperServices.js';
import type { CommonExtraction } from '../../aonprd/common.js';
import type { Section, SourceRef } from '../../aonprd/capabilities/strategy.js';
import type { ConceptDecl } from '../../aonprd/taxonomy.js';

/** Output shape for the secondary plugin's sample concept. */
export interface SampleOutput {
  _type:    'sample';
  url:      string;
  name:     string;
  sources:  SourceRef[];
  sections: Section[];
}

const finalizeSampleNode: NodeInterface<ScrapeState, 'success', RipperServices> = {
  name:    'finalize:sample',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: 'success' }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'success' };

    const assembled = {
      _type:    'sample' as const,
      url:      c.url,
      name:     c.title.name,
      sources:  c.sources,
      sections: c.sections,
    } satisfies SampleOutput;

    state.output = state.output !== null
      ? { ...state.output, ...assembled }
      : { ...assembled };

    return { output: 'success' };
  },
};

/**
 * Sample concept declaration. The capabilities are inherited from the
 * secondary plugin's parent concepts (`thing`, `entity`) which carry the
 * AONPRD Layer-1 capability nodes. The finalize node here is the only
 * concept-specific cap.
 */
export const sampleConcept: ConceptDecl<SampleOutput> = {
  id:       'sample',
  parent:   'entity',
  urlPaths: ['articles'],
  capabilities: [
    finalizeSampleNode,
  ],
};
