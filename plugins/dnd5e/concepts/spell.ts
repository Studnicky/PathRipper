// Spell concept — typed output shape + finalize node.
//
// Reads the stashed `dnd5eCheerio` + `dnd5eCommon` metadata, parses the spell
// statblock via `parseSpellTable`, assembles a `satisfies SpellOutput` literal,
// and merges it into `state.output`.
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';
import type { CheerioAPI } from 'cheerio';

import type { Section, LinkRef } from '../../../src/taxonomy/ExtractionStrategy.js';
import type { ConceptDecl } from '../../../src/taxonomy/Taxonomy.js';
import type { ScrapeState } from '../../../src/state/ScrapeState.js';
import type { Dnd5eCommon } from '../common.js';
import { parseSpellTable } from '../common.js';
import { setConceptOutput } from './_helpers.js';

export type SpellOutput = {
  url:              string;
  name:             string;
  source:           { book: string | null; page: number | null };
  category:         string | null;
  level:            number | null;
  school:           string | null;
  casting_time:     string | null;
  range:            string | null;
  components:        string | null;
  duration:         string | null;
  higher_levels:    string | null;
  description_text: string;
  sections:         Section[];
  links:            LinkRef[];
};

class FinalizeSpellNode extends ScalarNode<ScrapeState, 'success'> {
  public readonly name    = 'dnd5e:finalize-spell';
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
    const root   = state.getMetadata<CheerioAPI>('dnd5eCheerio');
    const common = state.getMetadata<Dnd5eCommon>('dnd5eCommon');
    // Open-world soft-fail: missing prerequisites become a no-op success.
    if (root === undefined || common === undefined) return NodeOutputBuilder.of('success');

    const table = parseSpellTable(root);

    const assembled = {
      url:              common.url,
      name:             common.name,
      source:           { book: common.source.book, page: common.source.page },
      category:         common.category,
      level:            table.level,
      school:           table.school,
      casting_time:     table.casting_time,
      range:            table.range,
      components:       table.components,
      duration:         table.duration,
      higher_levels:    table.higher_levels,
      description_text: common.body_text,
      sections:         common.sections,
      links:            common.links,
    } satisfies SpellOutput;

    setConceptOutput(state, assembled);

    return NodeOutputBuilder.of('success');
  }
}

export const finalizeSpellNode = new FinalizeSpellNode();

/**
 * Spell concept declaration. dandwiki URLs do not encode concept type, so
 * routing is by content classification (`classifyDnd5ePage`) in
 * `parse.taxonomic.ts`, not by URL. The `urlPaths` sentinel below makes `spell`
 * a valid leaf in the Taxonomy compiler; it is never matched by a real URL
 * because the plugin's `pathExtractor` always returns null.
 */
export const spellConcept: ConceptDecl<SpellOutput> = {
  id:           'spell',
  parent:       'entity',
  urlPaths:     ['5e_SRD:Spell'],
  capabilities: [finalizeSpellNode],
};
