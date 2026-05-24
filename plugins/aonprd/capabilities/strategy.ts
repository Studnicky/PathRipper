// Strategy interfaces for Layer-1 capabilities.
//
// Plugin-agnostic. Defines the shapes the Layer-1 capabilities produce plus
// the strategy interfaces a plugin supplies to teach `extractCommon` how to
// parse its source markup. A strategy implementation imports only from
// `cheerio` / `domhandler` and this file — never from `plugins/aonprd/`.
//
// H15: `SourceRefStrategy.extractSources` removes the hardcoded
// `<b>Source</b>` + `Sources.aspx?ID=` AON regex from the framework.
// H16: `SectionWalkerStrategy.harvestSections` removes the hardcoded
// `h2.title, h3.title` AON heading selector from the framework.
//
// AON-specific selectors / regexes live in
// `plugins/aonprd/strategies/aon.ts`. A future plugin (bulbapedia, torreya)
// supplies its own implementation of `CommonStrategy` and reuses the same
// Layer-1 capability binary.
import type { CheerioAPI, Cheerio } from 'cheerio';
import type { AnyNode } from 'domhandler';

/** Convenience alias used by strategy authors. */
export type CheerioTarget = Cheerio<AnyNode>;

/** Reference to a source citation parsed off a content page. */
export interface SourceRef {
  /** Source title (e.g. book / collection name) — null when unknown. */
  book:      string | null;
  /** Page number within the source, when discoverable. */
  page:      number | null;
  /** Numeric source identifier exposed by the source platform, when present. */
  source_id: number | null;
  /** Raw display text harvested from the page. */
  raw:       string;
}

/** Inline cross-reference harvested from a content page body. */
export interface LinkRef {
  /** Verbatim href attribute. */
  href: string;
  /** Display text of the anchor. */
  text: string;
  /** Target kind derived from the URL (plugin-specific classification). */
  kind: string;
  /** Numeric ID extracted from the URL, when present. */
  id:   number | null;
}

/** A heading + body fragment harvested from a content page. */
export interface Section {
  /** Heading text. */
  heading:   string;
  /** Logical heading depth (limited to the levels the walker is willing to emit). */
  level:     2 | 3;
  /** Plain-text rendering of the section body. */
  body_text: string;
  /** Raw HTML rendering of the section body. */
  body_html: string;
  /** Cross-reference links discovered inside the section body. */
  links:     LinkRef[];
}

/**
 * Strategy: source-citation extraction (H15).
 *
 * Given the resolved content target and the full-page CheerioAPI, return the
 * ordered list of source citations present on the page. The implementation
 * decides the markup pattern (regex, DOM walk, microdata, ...) — the
 * capability shape stays the same.
 */
export interface SourceRefStrategy {
  extractSources(target: CheerioTarget, $: CheerioAPI): SourceRef[];
}

/**
 * Strategy: section-walker extraction (H16).
 *
 * Given the full-page CheerioAPI and the resolved content target, return the
 * ordered list of heading-anchored sections. The strategy chooses which
 * selectors / heading levels constitute a section boundary for its source.
 */
export interface SectionWalkerStrategy {
  harvestSections($: CheerioAPI, target: CheerioTarget): Section[];
}

/**
 * Composite strategy bag supplied by a plugin to drive `extractCommon`.
 *
 * The current strategy surface covers source-citation extraction and
 * section-walker extraction. Additional Layer-1 extractors (title, traits,
 * fields, links, page-type detection) remain AON-shaped; a second source
 * plugin surfacing concrete needs can widen this interface.
 */
export interface CommonStrategy {
  readonly sourceRef:     SourceRefStrategy;
  readonly sectionWalker: SectionWalkerStrategy;
}
