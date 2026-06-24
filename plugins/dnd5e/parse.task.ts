// dnd5e parse task — public parse function + dispatcher registration.
import type { RipperDagonizer }  from '../../src/dispatcher/RipperDagonizer.js';
import type { ScrapeState }      from '../../src/state/ScrapeState.js';
import type { ConceptOutputUnion } from '../../src/types/Taxonomy.js';
import { TAXONOMY }              from './taxonomy/dnd5e.js';
import type { DND5E_TAXONOMY }   from './taxonomy/dnd5e.js';
import { dnd5eParseDAG }         from './parse.dag.js';
import { parseDnd5eHtmlTaxonomic } from './parse.taxonomic.js';

/**
 * Public parse output: the union of every concept's output type plus the
 * `{ url }` fallback shape for pages that match no concept.
 */
export type Dnd5eOutput = ConceptOutputUnion<typeof DND5E_TAXONOMY> | { url: string };

/** Parse a dandwiki HTML page into a typed concept output. */
export async function parseDnd5eHtml(html: string, url: string): Promise<Dnd5eOutput> {
  const output = await parseDnd5eHtmlTaxonomic(html, url);
  return output as Dnd5eOutput;
}

/** Register the dnd5e plugin's node instances and parse DAG on the dispatcher. */
export function register(dispatcher: RipperDagonizer<ScrapeState>): void {
  for (const node of TAXONOMY.allNodes()) {
    dispatcher.registerNode(node);
  }
  dispatcher.registerDAG(dnd5eParseDAG);
}
