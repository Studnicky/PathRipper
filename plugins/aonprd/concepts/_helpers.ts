// Concept helpers — shared output shapes + the typed setConceptOutput accessor.
//
// `SourceShape` and `BaseShape` are the single source of truth for the
// per-page projection that every entity-style concept extends.
//
// Finalize nodes call:
//
//   const assembled = {
//     url: c.url, name: c.title.name, // ... all required fields ...
//   } satisfies LanguageOutput;
//   setConceptOutput(state, assembled);
//
// The `satisfies` clause anchors the shape at the literal; the helper is a
// thin, monomorphic merge. Generic over `TOutput` so any plugin can use it
// with its own `*Output` types.
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

// ─── Shared output shapes ─────────────────────────────────────────────────────

/**
 * Header `Source` projection used by every entity-style concept's `Output`
 * type. Mirrors `SourceRef` minus `raw` (concept outputs do not surface the
 * raw display text alongside the parsed book/page/source_id).
 */
export interface SourceShape {
  book:      string | null;
  page:      number | null;
  source_id: number | null;
}

/**
 * Base shape shared by every entity-style concept's `Output` type. Concepts
 * extend this with concept-specific fields (level, stages, etc.) and their
 * own `<concept>_id`.
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
 * concept extends.
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
 * Merge a typed assembled output into `state.output`. The caller's `output`
 * literal carries a `satisfies XxxOutput` clause that fails `tsc` if any
 * required field is missing or any key is misspelled. The merge preserves
 * any keys already on `state.output` that the finalize node did not
 * repopulate.
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
