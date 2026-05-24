// Taxonomic parse entry point.
//
// Uses the compiled AONPRD taxonomy to dispatch concept-specific capability
// chains. Returns `state.output`; falls back to `{ url }` when the URL does
// not match any concept and no fallback concept is configured.
import type { NodeContextInterface } from '@noocodex/dagonizer';

import { ScrapeState }  from '../../src/state/ScrapeState.js';
import { TAXONOMY }     from './taxonomy/aonprd.js';
import type { RipperServices } from '../../src/services/RipperServices.js';

// Minimal NodeContextInterface — direct-call invokers don't have a dispatcher,
// so we synthesise the context shape the nodes receive when dispatched. The
// node base reads `services`, `signal`, `dagName`, `nodeName` from context;
// `services` is the only field nodes actively use in the AONPRD plugin (and
// even then, only a handful do).
const STUB_CONTEXT: NodeContextInterface<RipperServices> = {
  services: {} as RipperServices,
  signal:   new AbortController().signal,
  dagName:  'aonprd:parse:direct',
  nodeName: 'aonprd:parse:direct',
};

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
    await node.execute(state, STUB_CONTEXT);
  }

  const output = state.output;
  state.clearTransientMetadata();
  return output ?? { url };
}
