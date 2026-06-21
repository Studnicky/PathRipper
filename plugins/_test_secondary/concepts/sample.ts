// Sample concept for the `_test_secondary` plugin — Wave 5 proof-of-concept.
//
// Single concept that proves the AONPRD Layer-1 capabilities binary
// (`sectionWalkerNode`, `sourceRefNode`, `labelPairBlockNode`, `metaTagsNode`)
// can be reused with a non-AON strategy. The finalize node reads the
// projected `aonprdCommon.sections` / `.sources` that the secondary strategy
// populated and emits a minimal output shape.
import { ScalarNode, NodeOutputBuilder }                        from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';

import type { ScrapeState }    from '../../../src/state/ScrapeState.js';
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

class FinalizeSampleNodeImpl extends ScalarNode<ScrapeState, 'success'> {
  public readonly name    = 'finalize:sample';
  public readonly outputs = ['success'] as const;

  public override get outputSchema(): Record<'success', SchemaObjectType> {
    return {
      // `success` — `state.output` is merged with the assembled `SampleOutput`
      // object drawn from `aonprdCommon` metadata.
      success: {
        type: 'object',
        properties: {
          output: { type: 'object' },
        },
        required: ['output'],
      },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<'success'>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('success');

    const assembled = {
      _type:    'sample' as const,
      url:      common.url,
      name:     common.title.name,
      sources:  common.sources,
      sections: common.sections,
    } satisfies SampleOutput;

    state.output = state.output !== null
      ? { ...state.output, ...assembled }
      : { ...assembled };

    return NodeOutputBuilder.of('success');
  }
}

const finalizeSampleNode = new FinalizeSampleNodeImpl();

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
