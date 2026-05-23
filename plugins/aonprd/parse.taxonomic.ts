// Taxonomic parse entry point — Phase 6.3.
//
// A thin alternative to `parse.task.ts` that uses the compiled AONPRD taxonomy
// to dispatch concept-specific capability chains. The existing `parse.task.ts`
// is not modified; this file is what Phase 6.3 tests invoke directly.
//
// Usage:
//   const result = await parseAonHtmlTaxonomic(html, url);
//   // result._type === 'language' for Languages.aspx pages
//   // result._type === 'unknown' for unrecognised pages

import type { NodeContextInterface } from '@noocodex/dagonizer';

import { ScrapeState }  from '../../src/state/ScrapeState.js';
import { Logger }       from '../../src/modules/logger/logger.js';
import { TAXONOMY }     from './taxonomy/aonprd.js';
import type { RipperServices } from '../../src/services/RipperServices.js';

const log = Logger.forComponent('AonprdTaxonomic');

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
 * Parse an AON HTML page via the compiled AONPRD taxonomy.
 *
 * Looks up the URL's concept, runs the full inherited capability chain
 * sequentially, and returns `state.output`. Returns `{ _type: 'unknown', url }`
 * when the URL does not match any concept OR when the chain completes without
 * producing a `_type` field on `state.output` (the only failure mode under
 * open-world semantics — see `docs/taxonomic-extraction-redesign.md`).
 *
 * @param html - Raw HTML string of the page.
 * @param url  - Canonical URL of the page (used for concept routing).
 */
export async function parseAonHtmlTaxonomic(html: string, url: string): Promise<Record<string, unknown>> {
  const state = new ScrapeState();
  // `targetId: 'aonprd'` couples this entry point to the AON plugin name.
  // Tests + the DAG-dispatched path both expect this id. If a future entry
  // point needs to invoke the taxonomy from a different plugin context, lift
  // this into a parameter (Wave 7 L10).
  state.page  = { targetId: 'aonprd', title: '', url, html };
  // Wave 7 L4: pre-seed state.output to {} so concept finalize nodes
  // don't need to null-guard on every merge. The downstream null-guard
  // ternaries (`state.output !== null ? {...state.output, ...x} : {...x}`)
  // become trivially true once this seeding is in place; they can be
  // mechanically simplified in a follow-up sweep.
  state.output = {};

  // Wave 7 M7: when no URL match, fall back to the fallback concept
  // (typically `generic`) if one is configured. Operators still see the
  // fallback being hit via the concept's `_type` discriminator on the output.
  const conceptId = TAXONOMY.routeUrl(url) ?? TAXONOMY.fallbackConceptId();
  if (conceptId === null) {
    return { _type: 'unknown', url };
  }

  // Wave 6 M1: stamp the concept's discriminator (e.g. `{ _type: 'language' }`)
  // onto state.output before the chain runs. The DAG path performs the same
  // stamp inside `aonprd:taxonomy-route`; direct-call does it here.
  const discriminator = TAXONOMY.discriminatorFor(conceptId);
  if (Object.keys(discriminator).length > 0) {
    state.output = { ...discriminator };
  }

  const chain = TAXONOMY.chainFor(conceptId);

  // Run every capability in the chain. An 'error' from any capability (e.g.
  // labelPairBlockNode for rule pages that have no aonprdTarget) is
  // non-fatal: the open-world contract permits capabilities whose required
  // metadata is absent to no-op and continue. The chain as a whole only fails
  // if state.output is never populated with a `_type` discriminator by the
  // concept-specific finalize node — checked below.
  for (const node of chain) {
    await node.execute(state, STUB_CONTEXT);
  }

  // End-of-chain _type presence check (Wave 3 H10). Under open-world
  // semantics, individual capability errors do not propagate — the only
  // failure mode is "chain completed without producing a typed output".
  // Surface as a contract warning so operators know which URL routed
  // through a concept whose finalize node failed to populate output.
  const output = state.output;

  // Wave 7 M5/M11: release transient metadata (CheerioAPI handles, raw
  // CommonExtraction objects) before returning so large parsed DOM trees
  // are GC-eligible and don't leak across parses in fan-out dispatchers.
  state.clearTransientMetadata();

  if (output === null || typeof output['_type'] !== 'string') {
    log.warn(
      'contract-warning',
      `AONPRD taxonomy chain for concept '${conceptId}' completed without producing a '_type' field`,
      { url, conceptId },
    );
    return { _type: 'unknown', url };
  }

  return output;
}
