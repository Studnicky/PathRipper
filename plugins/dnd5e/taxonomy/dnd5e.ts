// dnd5e Taxonomy.
//
// Declares the compiled concept tree for the dnd5e plugin. dandwiki URLs do not
// encode concept type, so `pathExtractor` always returns null — content
// classification (`classifyDnd5ePage`) drives concept selection in
// `parse.taxonomic.ts`. The compiled taxonomy still provides the node set and
// the DAG topology.
import { Taxonomy } from '../../../src/taxonomy/Taxonomy.js';
import type { ConceptDecl, ConceptOutputUnion } from '../../../src/taxonomy/Taxonomy.js';
import { thingConcept, entityConcept } from '../concepts/_interior.js';
import { spellConcept } from '../concepts/spell.js';
import { genericConcept } from '../concepts/generic.js';

export const DND5E_TAXONOMY = [
  thingConcept,
  entityConcept,
  spellConcept,
  genericConcept,
] as const satisfies readonly ConceptDecl<unknown>[];

/**
 * dandwiki URLs do not encode concept type, so the path extractor returns null
 * for every URL — the URL router never matches a leaf and the fallback
 * (`generic`) concept is selected. Content classification overrides this in
 * `parse.taxonomic.ts` via `classifyDnd5ePage`.
 */
function pathExtractor(_url: string): string | null {
  return null;
}

export const TAXONOMY = Taxonomy.compile(DND5E_TAXONOMY, { namespace: 'dnd5e', pathExtractor });
export type Dnd5eOutput = ConceptOutputUnion<typeof DND5E_TAXONOMY>;
