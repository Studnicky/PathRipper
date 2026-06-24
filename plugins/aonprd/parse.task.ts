// AON HTML parse plugin entry point.
//
// Exports:
//   - `register(dispatcher)` — registers all taxonomy nodes and the DAG.
//   - `parseAonHtml(html, url)` — async direct-call API for tests and
//     dispatcher-less consumers.

import type { RipperDagonizer } from '../../src/dispatcher/RipperDagonizer.js';
import type { ScrapeState }     from '../../src/state/ScrapeState.js';

import { TAXONOMY } from './taxonomy/aonprd.js';
import type { AONPRD_TAXONOMY } from './taxonomy/aonprd.js';
import { aonprdParseDAG } from './parse.dag.js';
import { parseAonHtmlTaxonomic } from './parse.taxonomic.js';
import type { ConceptOutputUnion } from '../../src/types/Taxonomy.js';

// ── Type exports ───────────────────────────────────────────────────────────────

/** Fallback output for unrecognised or unroutable URLs. */
export interface UnknownOutput {
  url: string;
}

/**
 * Union of every typed output the AON parser produces. Derived from
 * `AONPRD_TAXONOMY` — adding a new concept with a `ConceptDecl<XxxOutput>`
 * declaration automatically widens this union. Interior concepts (`thing`,
 * `entity`) declared with the default (`never`) TOutput contribute nothing.
 */
export type AonOutput = ConceptOutputUnion<typeof AONPRD_TAXONOMY> | UnknownOutput;

// ── Direct-call API ────────────────────────────────────────────────────────────

/** Parse a fully-loaded AON detail page and return a typed structured record. */
export async function parseAonHtml(html: string, url: string): Promise<AonOutput> {
  return parseAonHtmlTaxonomic(html, url) as unknown as Promise<AonOutput>;
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
