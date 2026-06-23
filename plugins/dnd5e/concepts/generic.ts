// Generic concept — fallback typed output shape + finalize node.
//
// Receives any page that `classifyDnd5ePage` does not classify as a spell.
// Reads the stashed `dnd5eCommon` projection and assembles the generic output.
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';

import type { Section, LinkRef } from '../../../src/taxonomy/ExtractionStrategy.js';
import type { ConceptDecl } from '../../../src/taxonomy/Taxonomy.js';
import type { ScrapeState } from '../../../src/state/ScrapeState.js';
import type { Dnd5eCommon } from '../common.js';
import { setConceptOutput } from './_helpers.js';

export type GenericOutput = {
  url:       string;
  name:      string;
  source:    { book: string | null; page: number | null };
  category:  string | null;
  body_text: string;
  sections:  Section[];
  links:     LinkRef[];
};

class FinalizeGenericNode extends ScalarNode<ScrapeState, 'success'> {
  public readonly name    = 'dnd5e:finalize-generic';
  public readonly outputs = ['success'] as const;

  public override get outputSchema(): Record<'success', SchemaObjectType> {
    return {
      success: { type: 'object', properties: { output: { type: 'object' } }, required: ['output'] },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<'success'>> {
    const common = state.getMetadata<Dnd5eCommon>('dnd5eCommon');
    if (common === undefined) return NodeOutputBuilder.of('success');

    const assembled = {
      url:       common.url,
      name:      common.name,
      source:    { book: common.source.book, page: common.source.page },
      category:  common.category,
      body_text: common.body_text,
      sections:  common.sections,
      links:     common.links,
    } satisfies GenericOutput;

    setConceptOutput(state, assembled);

    return NodeOutputBuilder.of('success');
  }
}

export const finalizeGenericNode = new FinalizeGenericNode();

/** Generic fallback concept. `urlPaths: []` marks it as the taxonomy fallback. */
export const genericConcept: ConceptDecl<GenericOutput> = {
  id:           'generic',
  parent:       'entity',
  urlPaths:     [],
  capabilities: [finalizeGenericNode],
};
