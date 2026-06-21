// Taxonomic parse entry point.
//
// Uses the compiled AONPRD taxonomy to dispatch concept-specific capability
// chains. Returns `state.output`; falls back to `{ url }` when the URL does
// not match any concept and no fallback concept is configured.
import { Batch }              from '@studnicky/dagonizer';
import { NodeContextBuilder } from '@studnicky/dagonizer/entities';

import { ScrapeState }  from '../../src/state/ScrapeState.js';
import { TAXONOMY }     from './taxonomy/aonprd.js';


/**
 * Parse an AON HTML page via the compiled AONPRD taxonomy. Looks up the
 * URL's concept, runs the full inherited capability chain sequentially, and
 * returns `state.output`. When the URL does not match any concept and no
 * fallback is configured, returns `{ url }`.
 */
export async function parseAonHtmlTaxonomic(html: string, url: string): Promise<Record<string, unknown>> {
  const state = new ScrapeState();
  state.page  = { targetId: 'aonprd', title: '', url, html };
  state.output = {};

  const conceptId = TAXONOMY.routeUrl(url) ?? TAXONOMY.fallbackConceptId();
  if (conceptId === null) {
    return { url };
  }

  const chain = TAXONOMY.chainFor(conceptId);
  for (const node of chain) {
    await node.execute(Batch.of(state), NodeContextBuilder.of('aonprd:parse:direct', 'aonprd:parse:direct', new AbortController().signal, undefined));
  }

  const output = state.output;
  state.clearTransientMetadata();
  return output ?? { url };
}
