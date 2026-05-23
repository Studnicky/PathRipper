// AON HTML parse plugin — Phase 6.4 wave 2 cut-over entry point.
//
// Exports:
//   - `register(dispatcher)` — explicit plugin contract. Called by `RipperRun`
//     after importing this module. Registers all taxonomy nodes and the DAG.
//   - `parseAonHtml(html, url)` — async direct-call API for unit tests and
//     consumers that don't need the dispatcher. Delegates to the taxonomy
//     capability chains compiled from `TAXONOMY`.
//
// Wave 5 per-type modules have been removed. All extraction logic lives in
// `plugins/aonprd/concepts/<concept>.ts` and the shared capability nodes
// under `plugins/aonprd/capabilities/`.

import type { RipperDagonizer } from '../../src/dispatcher/RipperDagonizer.js';
import type { ScrapeState }     from '../../src/state/ScrapeState.js';

import { TAXONOMY, AONPRD_TAXONOMY } from './taxonomy/aonprd.js';
import { aonprdParseDAG } from './parse.dag.js';
import { parseAonHtmlTaxonomic } from './parse.taxonomic.js';
import type { ConceptOutputUnion } from './taxonomy.js';

// ── Type exports ───────────────────────────────────────────────────────────────

/** Unknown output for unrecognised or unroutable URLs. */
export interface UnknownOutput {
  _type: 'unknown';
  url:   string;
}

/**
 * Discriminated union of every typed output the AON parser produces.
 *
 * Derived from `AONPRD_TAXONOMY` (Wave 4 H9 step 5) — adding a new concept
 * with a `ConceptDecl<XxxOutput>` declaration automatically widens this union
 * with no change to this file. Interior concepts (`thing`, `entity`) declared
 * with the default (`never`) TOutput contribute nothing to the union (`never`
 * is identity for unions); the union resolves to the leaf-only set plus
 * `UnknownOutput`.
 */
export type AonOutput = ConceptOutputUnion<typeof AONPRD_TAXONOMY> | UnknownOutput;

// ── Direct-call API ────────────────────────────────────────────────────────────

/**
 * Parse a fully-loaded AON detail page and return a typed structured record.
 *
 * Delegates to the taxonomy capability chains compiled from `TAXONOMY`. The
 * Wave 5 per-type modules have been removed; all extraction logic is now in
 * `plugins/aonprd/concepts/<concept>.ts`.
 *
 * @param html - Raw HTML string of the AON detail page.
 * @param url  - Canonical URL of the page (used for concept routing).
 */
export async function parseAonHtml(html: string, url: string): Promise<AonOutput> {
  return parseAonHtmlTaxonomic(html, url) as Promise<AonOutput>;
}

// ── Plugin contract ────────────────────────────────────────────────────────────

/**
 * Explicit plugin registration. Called by `RipperRun` after importing this module.
 * Registers all taxonomy-compiled nodes and the `aonprd:parse` DAG.
 *
 * @param dispatcher - The `RipperDagonizer` instance for the current scrape run.
 */
export function register(dispatcher: RipperDagonizer<ScrapeState>): void {
  for (const node of TAXONOMY.allNodes()) {
    dispatcher.registerNode(node);
  }
  dispatcher.registerDAG(aonprdParseDAG);
}
