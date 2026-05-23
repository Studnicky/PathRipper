// Concept helpers — Wave 4 H9, Wave 6 L5.
//
// Plugin-agnostic typed-output infrastructure for concept finalize nodes.
// The `setConceptOutput` helper carries the compile-time `satisfies` check
// that prevents misspelled keys from leaking through `state.output`.
//
// Wave 6 L5 / M4: `SourceShape` and `BaseShape` are lifted here as the single
// source of truth for the per-page projection that every entity-style concept
// extends. Four concept files (generic.ts, condition.ts, hazard.ts, trait.ts)
// previously redeclared them inline. The shared `BaseShape` no longer carries
// `entity_id` — Wave 6 M4 standardised ID naming to `<concept>_id` so the
// generic alias is no longer needed.
//
// Today every finalize node hand-merges `assembled` into `state.output` with
// a `{ ...state.output, ...assembled }` literal. The merge is untyped — TS
// has no way to verify that `assembled` matches the concept's declared
// `*Output` shape. A misspelled key compiles cleanly.
//
// Finalize nodes opt into the typed accessor by calling:
//
//   const assembled = {
//     _type: 'language' as const,
//     // ... all required fields ...
//   } satisfies LanguageOutput;
//   setConceptOutput(state, assembled);
//
// The `satisfies` clause at the literal anchors the shape; `setConceptOutput`
// is a thin, monomorphic merge. Both pieces together produce the compile-time
// guarantee that's been documented but unenforced through Wave 3.
//
// The helper is generic over `TOutput` (no plugin coupling) — a future
// bulbapedia/torreya plugin uses the same helper with its own `*Output` types.
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState } from '../../../src/state/ScrapeState.js';
import {
  type CommonExtraction,
  type LinkRef,
  type PfsLegality,
  type Rarity,
  type Section,
  type SourceRef,
  extractMetaDescription,
  extractMetaKeywords,
} from '../common.js';

// ─── Shared output shapes (Wave 6 L5) ─────────────────────────────────────────

/**
 * Header `Source` projection used by every entity-style concept's `Output`
 * type. Mirrors `SourceRef` minus `raw` (concept outputs do not surface the
 * raw display text alongside the parsed book/page/source_id). Lifted from the
 * four files that previously redeclared it (generic, condition, hazard,
 * trait).
 */
export interface SourceShape {
  book:      string | null;
  page:      number | null;
  source_id: number | null;
}

/**
 * Base shape shared by every entity-style concept's `Output` type. Concepts
 * extend this with their own `_type` discriminator and any concept-specific
 * fields (level, stages, etc.). The `<concept>_id` for each concept lives on
 * the concept-specific output, never here — `entity_id` was removed in
 * Wave 6 M4.
 */
export interface BaseShape {
  url:             string;
  name:            string;
  rarity:          Rarity;
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;
  traits:          string[];
  /** Trait AON IDs keyed by trait name. */
  trait_ids:       Record<string, number>;
  source:          SourceShape;
  /** All source refs on the page (header + body footnotes). */
  sources:         SourceRef[];
  sections:        Section[];
  raw_fields:      Record<string, string>;
  links:           LinkRef[];
  body_text:       string;
  body_html:       string;
  /** `<meta name="description">` content. */
  meta_description: string | null;
  /** `<meta name="keywords">` content. */
  meta_keywords:   string | null;
}

/**
 * Build a `BaseShape` from a {@link CommonExtraction} + full-page CheerioAPI.
 * Single source of truth for the per-page projection that every entity-style
 * concept extends. The four duplicates in concept files have been removed.
 */
export function baseFrom(c: CommonExtraction, $: CheerioAPI): BaseShape {
  return {
    url:             c.url,
    name:            c.title.name,
    rarity:          c.traits.rarity,
    pfs:             c.title.pfs,
    legacy:          c.title.legacy,
    alt_edition_url: c.title.alt_edition_url,
    traits:          c.traits.traits,
    trait_ids:       c.traits.trait_ids,
    source:          { book: c.source.book, page: c.source.page, source_id: c.source.source_id },
    sources:         c.sources,
    sections:        c.sections,
    raw_fields:      { ...c.field_map },
    links:           c.links,
    body_text:       c.body_text,
    body_html:       c.body_html,
    meta_description: extractMetaDescription($),
    meta_keywords:   extractMetaKeywords($),
  };
}

/**
 * Merge a typed assembled output into `state.output` (Wave 4 H9 step 3).
 *
 * The caller's `output` literal carries a `satisfies XxxOutput` clause that
 * fails `tsc` if any required field is missing or any key is misspelled.
 * This helper itself is monomorphic — it does not validate the shape; it
 * only merges. The compile-time guarantee comes from the call-site
 * `satisfies` and the explicit `TOutput` parameter.
 *
 * The merge behaviour preserves any keys already on `state.output` that the
 * finalize node did not repopulate (Wave 6 H13 — "preserve contract slack").
 * Concepts that need overwrite semantics can `state.output = { ...assembled }`
 * directly; the helper is opt-in for the merge variant.
 *
 * @example
 * ```ts
 * const assembled = {
 *   _type: 'language' as const,
 *   url: c.url,
 *   name: c.title.name,
 *   // ... every field of LanguageOutput ...
 * } satisfies LanguageOutput;
 * setConceptOutput(state, assembled);
 * ```
 */
export function setConceptOutput<TOutput extends object>(
  state:  ScrapeState,
  output: TOutput,
): void {
  // The `TOutput` parameter is typically a concept's typed `*Output` interface
  // (no string index signature). The `Record<string, unknown>` shape of
  // `state.output` accommodates the merge structurally — we cast at the
  // assignment to bridge the index-signature mismatch.
  const merged: Record<string, unknown> = state.output !== null
    ? { ...state.output, ...(output as Record<string, unknown>) }
    : { ...(output as Record<string, unknown>) };
  state.output = merged;
}
