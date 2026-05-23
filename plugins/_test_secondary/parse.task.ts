// Secondary plugin direct-call entry point — Wave 5 proof-of-concept.
//
// Mirrors `plugins/aonprd/parse.taxonomic.ts` but dispatches against the
// SECONDARY taxonomy. Demonstrates the AONPRD Layer-1 capabilities binary
// is plugin-agnostic when paired with a plugin-supplied `CommonStrategy`.
import type { NodeContextInterface } from '@noocodex/dagonizer';

import { ScrapeState } from '../../src/state/ScrapeState.js';
import type { RipperServices } from '../../src/services/RipperServices.js';
import { TAXONOMY } from './taxonomy.js';

const STUB_CONTEXT: NodeContextInterface<RipperServices> = {
  services: {} as RipperServices,
  signal:   new AbortController().signal,
  dagName:  'secondary:parse:direct',
  nodeName: 'secondary:parse:direct',
};

/**
 * Parse a secondary-source HTML page via the compiled secondary taxonomy.
 *
 * @param html - Raw HTML string of the page.
 * @param url  - Canonical URL of the page (must contain a `.aspx` path token
 *               for the AON-shaped router; the secondary stub only needs to
 *               prove the Layer-1 capability reuse, not the router).
 */
export async function parseSecondaryHtml(
  html: string,
  url:  string,
): Promise<Record<string, unknown>> {
  const state = new ScrapeState();
  state.page  = { targetId: '_test_secondary', title: '', url, html };

  const conceptId = TAXONOMY.routeUrl(url);
  if (conceptId === null) {
    return { _type: 'unknown', url };
  }

  const chain = TAXONOMY.chainFor(conceptId);
  for (const node of chain) {
    await node.execute(state, STUB_CONTEXT);
  }

  const output = state.output;
  if (output === null || typeof output['_type'] !== 'string') {
    return { _type: 'unknown', url };
  }
  return output;
}
