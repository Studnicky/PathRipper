// Secondary plugin direct-call entry point — Wave 5 proof-of-concept.
//
// Mirrors `plugins/aonprd/parse.taxonomic.ts` but dispatches against the
// SECONDARY taxonomy. Demonstrates the AONPRD Layer-1 capabilities binary
// is plugin-agnostic when paired with a plugin-supplied `CommonStrategy`.
import { Batch }                from '@studnicky/dagonizer';
import { NodeContextBuilder } from '@studnicky/dagonizer/entities';

import { ScrapeState } from '../../src/state/ScrapeState.js';
import { TAXONOMY } from './taxonomy.js';

const STUB_CONTEXT = NodeContextBuilder.of('secondary:parse:direct', 'secondary:parse:direct', new AbortController().signal, undefined);

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
    await node.execute(Batch.of(state), STUB_CONTEXT);
  }

  const output = state.output;
  if (output === null || typeof output['_type'] !== 'string') {
    return { _type: 'unknown', url };
  }
  return output;
}
