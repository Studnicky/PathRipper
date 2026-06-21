//
// Source pages (Sources.aspx) are book metadata entries: product page URL,
// release date, product line, source group, errata version, and an extensive
// catalog of every entity sourced from that book organized by h2 category
// headings. Helpers are inlined with inline contracts.
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState }    from '../../../src/state/ScrapeState.js';
import type { ConceptDecl } from '../taxonomy.js';
import { setConceptOutput } from './_helpers.js';
import {
  CAPABILITY_OUTPUTS,
  type CommonExtraction,
  type CheerioNode,
  type LinkRef,
  type Rarity,
  type PfsLegality,
  type Section,
  type SourceRef,
  getField,
  htmlToText,
  extractEntityId,
  extractMetaDescription,
  extractMetaKeywords,
  stripStructuredKeys,
} from '../common.js';

// ─── Output type ─────────────────────────────────────────────────────────────

/**
 * A linked AON entity referenced from this book's catalog sections (Ancestries,
 * Spells, Feats, …). Captured as a flat list because consumers typically want
 * to enumerate every entity the book introduced.
 */
export interface SourceRelated {
  /** Display name of the entity link. */
  name:     string;
  /** Verbatim href (resolved against `https://2e.aonprd.com`). */
  href:     string;
  /** AON entity ID from `?ID=N`. */
  aon_id: number | null;
  /** Target kind derived from `.aspx` filename — `Spells`, `Feats`, etc. */
  kind:     string;
  /** Catalog category heading the entity was listed under (e.g. "Ancestries"). */
  category: string;
}

export interface SourceOutput {
  url:                 string;
  /** Numeric AON Sources.aspx ID extracted from the URL query string. */
  source_id:           number | null;
  /** Book title (same as `name`; preserved for symmetry with other types). */
  name:                string;
  rarity:              Rarity;
  pfs:                 PfsLegality | null;
  legacy:              boolean;
  alt_edition_url:     string | null;
  traits:              string[];
  trait_ids:           Record<string, number>;
  /** Source meta — sources rarely self-reference, so this is usually empty. */
  source:              { book: string | null; page: number | null; source_id: number | null };
  sources:             SourceRef[];

  // ─── Product metadata ──────────────────────────────────────────────────────
  /** URL to the Paizo store / official product page, when available. */
  product_page:        string | null;
  /** Release date string as printed on AON (e.g. "8/1/2019"). */
  release_date:        string | null;
  /** Product line label (e.g. "Rulebooks", "Adventure Paths", "Lost Omens"). */
  product_line:        string | null;
  /** Source-group label (Adventure Paths/anthology bucket). */
  source_group:        string | null;
  /** Latest errata version + date (e.g. "4.0 - 1/3/2023"), when present. */
  latest_errata:       string | null;

  // ─── Catalog ───────────────────────────────────────────────────────────────
  /** Every linked entity catalogued from this book, in source order. */
  related_sources:     SourceRelated[];

  // ─── Bookkeeping ───────────────────────────────────────────────────────────
  sections:            Section[];
  raw_fields:          Record<string, string>;
  links:               LinkRef[];
  body_text:           string;
  body_html:           string;
  meta_description:    string | null;
  meta_keywords:       string | null;
}

// ─── Per-node slice types ─────────────────────────────────────────────────────

/** Fields owned by `extract-source-base`. */
export interface SourceBaseSlice {
  url:             string;
  source_id:       number | null;
  name:            string;
  rarity:          Rarity;
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;
  traits:          string[];
  trait_ids:       Record<string, number>;
  source:          SourceOutput['source'];
  sources:         SourceRef[];
}

/** Fields owned by `extract-source-metadata`. */
export interface SourceMetadataSlice {
  product_page:  string | null;
  release_date:  string | null;
  product_line:  string | null;
  source_group:  string | null;
  latest_errata: string | null;
}

/** Fields owned by `extract-source-related`. */
export interface SourceRelatedSlice {
  related_sources: SourceRelated[];
}

/** Fields owned by `extract-source-meta`. */
export interface SourceMetaSlice {
  __source_meta_marked: true;
}

// ─── Product-metadata helpers ─────────────────────────────────────────────────

/**
 * Extract the first `<a href>` URL embedded in a field's value HTML (Product
 * Page values are rendered as `<u><a href="https://…">Paizo Store</a></u>`).
 * Falls back to the field's text value when no anchor is present.
 */
function extractFieldHref(common: CommonExtraction, label: string): string | null {
  for (const field of common.fields) {
    if (field.label.toLowerCase() !== label.toLowerCase()) continue;
    const match = /href="([^"]+)"/i.exec(field.value_html);
    if (match !== null) return match[1]!;
    const text = htmlToText(field.value_html).trim();
    return text === '' ? null : text;
  }
  return null;
}

// ─── Related-entity harvest (DOM-walking via Cheerio) ─────────────────────────

/**
 * Walk each `<h2 class="title">{Category} [N]</h2>` block and collect every
 * `<a href="<Kind>.aspx…">` anchor in the following content. Uses Cheerio DOM
 * walking rather than regex over the body HTML.
 *
 * The category label is the h2's text with the trailing `[N]` count stripped.
 */
function parseRelated(root: CheerioAPI, target: CheerioNode): SourceRelated[] {
  const out: SourceRelated[] = [];
  const seen = new Set<string>();

  target.find('h2.title').each((_index, element) => {
    const $heading = root(element);
    const headingRaw = $heading.text().replace(/\s+/g, ' ').trim();
    if (headingRaw === '') return;
    // Strip trailing "[N]" entity count for a clean category label.
    const category = headingRaw.replace(/\s*\[\d+\]\s*$/, '').trim();
    if (category === '') return;

    // Collect anchors between this heading and the next h2/h3.
    let cur = ($heading.get(0) as { next: { tagName?: string; type: string } | null } | undefined)?.next ?? null;
    while (cur !== null) {
      // Cheerio's Element typings vary; cast to a minimal shape for traversal.
      const node = cur as unknown as { type: string; tagName?: string; next: unknown };
      if (node.type === 'tag') {
        const tag = (node.tagName ?? '').toLowerCase();
        if (tag === 'h2' || tag === 'h3' || tag === 'h1') break;
      }
      // Collect every anchor reachable from this node.
      const $wrapper = root(cur as unknown as Parameters<typeof root>[0]);
      $wrapper.find('a[href]').addBack('a[href]').each((_innerIndex, anchor) => {
        const $anchor = root(anchor);
        const href = $anchor.attr('href') ?? '';
        if (href === '') return;
        const aspxMatch = /([A-Za-z][A-Za-z0-9]*)\.aspx/.exec(href);
        if (aspxMatch === null) return;
        const kind = aspxMatch[1]!;
        const idMatch = /\?ID=(\d+)/i.exec(href);
        const aon_id = idMatch !== null ? parseInt(idMatch[1]!, 10) : null;
        const name = htmlToText($anchor.html() ?? '');
        if (name === '') return;
        const key = `${href}|${name}|${category}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ name, href, aon_id, kind, category });
      });
      cur = node.next as typeof cur;
    }
  });

  return out;
}

// ─── Per-slice extraction helpers ─────────────────────────────────────────────

/** Extract base identity + header scalars for a source page. */
export function extractSourceBase(common: CommonExtraction): SourceBaseSlice {
  return {
    url:             common.url,
    source_id:       extractEntityId(common.url),
    name:            common.title.name,
    rarity:          common.traits.rarity,
    pfs:             common.title.pfs,
    legacy:          common.title.legacy,
    alt_edition_url: common.title.alt_edition_url,
    traits:          common.traits.traits,
    trait_ids:       common.traits.trait_ids,
    source:          { book: common.source.book, page: common.source.page, source_id: common.source.source_id },
    sources:         common.sources,
  };
}

/** Extract the four product-metadata fields plus optional errata version. */
export function extractSourceMetadata(common: CommonExtraction): SourceMetadataSlice {
  return {
    product_page:  extractFieldHref(common, 'Product Page'),
    release_date:  getField(common, 'Release Date'),
    product_line:  getField(common, 'Product Line'),
    source_group:  getField(common, 'Source Group'),
    latest_errata: getField(common, 'Latest Errata'),
  };
}

/** Extract catalog cross-references from the `<h2 class="title">` sections. */
export function extractSourceRelated(root: CheerioAPI, target: CheerioNode): SourceRelatedSlice {
  return { related_sources: parseRelated(root, target) };
}

/** Extract meta slice marker — sections/links/body/meta attach in finalize. */
export function extractSourceMeta(_common: CommonExtraction): SourceMetaSlice {
  return { __source_meta_marked: true };
}

// ─── Finalize ────────────────────────────────────────────────────────────────

/** AON labels claimed by upstream source slices. */
const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Source',
  'Product Page', 'Release Date', 'Product Line', 'Source Group', 'Latest Errata',
  // Module-style sources carry an `Encounters` link list.
  'Encounters',
];

export function finalizeSource(
  common:    CommonExtraction,
  base:      SourceBaseSlice,
  metadata:  SourceMetadataSlice,
  related:   SourceRelatedSlice,
  _meta:     SourceMetaSlice,
  root:      CheerioAPI,
  _target:   CheerioNode,
): SourceOutput {
  void _meta;
  void _target;
  const raw_fields = stripStructuredKeys(common.field_map, CLAIMED_FIELD_LABELS);
  return {
    ...base,
    product_page:     metadata.product_page,
    release_date:     metadata.release_date,
    product_line:     metadata.product_line,
    source_group:     metadata.source_group,
    latest_errata:    metadata.latest_errata,
    related_sources:  related.related_sources,
    sections:         common.sections,
    raw_fields,
    // Sources.aspx has no `<hr/>` separator so `body_html` is empty after the
    // shared `splitOnHr` fallback — fall back to the canonical span-wide link
    // harvest so catalog anchors aren't dropped.
    links:            common.links,
    body_text:        common.body_text,
    body_html:        common.body_html,
    meta_description: extractMetaDescription(root),
    meta_keywords:    extractMetaKeywords(root),
  } satisfies SourceOutput;
}

/**
 * Project a Sources.aspx page into a typed SourceOutput.
 *
 * Thin assembly wrapper kept for `parseAonHtml` direct-call paths and unit
 * tests.
 */
export function extractSource(
  common: CommonExtraction,
  root:   CheerioAPI,
  target: CheerioNode,
): SourceOutput {
  const base     = extractSourceBase(common);
  const metadata = extractSourceMetadata(common);
  const related  = extractSourceRelated(root, target);
  const meta     = extractSourceMeta(common);
  return finalizeSource(common, base, metadata, related, meta, root, target);
}

// Re-export output type so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

export type SourceBaseOutput = 'success' | 'error';

class SourceBaseNodeImpl extends ScalarNode<ScrapeState, SourceBaseOutput> {
  public readonly name    = 'extract:source-base';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<SourceBaseOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const base = extractSourceBase(common);

    state.output = { ...state.output, ...base };

    return NodeOutputBuilder.of('success');
  }
}
export const sourceBaseNode = new SourceBaseNodeImpl();

// ─────────────────────────────────────────────────────────────────────────────

export type SourceMetadataOutput = 'success' | 'error';

class SourceMetadataNodeImpl extends ScalarNode<ScrapeState, SourceMetadataOutput> {
  public readonly name    = 'extract:source-metadata';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<SourceMetadataOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const metadata = extractSourceMetadata(common);

    state.output = { ...state.output, ...metadata };

    return NodeOutputBuilder.of('success');
  }
}
export const sourceMetadataNode = new SourceMetadataNodeImpl();

// ─────────────────────────────────────────────────────────────────────────────

export type SourceRelatedOutput = 'success' | 'error';

class SourceRelatedNodeImpl extends ScalarNode<ScrapeState, SourceRelatedOutput> {
  public readonly name    = 'extract:source-related';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<SourceRelatedOutput>> {
    const root   = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (root === undefined || target === undefined) return NodeOutputBuilder.of('error');

    const related = extractSourceRelated(root, target);

    state.output = { ...state.output, ...related };

    return NodeOutputBuilder.of('success');
  }
}
export const sourceRelatedNode = new SourceRelatedNodeImpl();

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeSourceOutput = 'success';

class FinalizeSourceNodeImpl extends ScalarNode<ScrapeState, FinalizeSourceOutput> {
  public readonly name    = 'finalize:source';
  public readonly outputs = ['success'] as const;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<FinalizeSourceOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root   = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (common === undefined || root === undefined || target === undefined) return NodeOutputBuilder.of('success');

    // Pass a meta marker inline — finalizeSource ignores it (void _meta).
    const meta  = { __source_meta_marked: true as const };
    const acc   = (state.output ?? {}) as unknown as SourceOutput;
    const assembled = finalizeSource(common, acc, acc, acc, meta, root, target);
    setConceptOutput(state, assembled);

    return NodeOutputBuilder.of('success');
  }
}
export const finalizeSourceNode = new FinalizeSourceNodeImpl();

// ─── ConceptDecl export ───────────────────────────────────────────────────────

export const sourceConcept: ConceptDecl<SourceOutput> = {
  id:       'source',
  parent:   'entity',
  urlPaths: ['sources'],
  capabilities: [
    sourceBaseNode,
    sourceMetadataNode,
    sourceRelatedNode,
    finalizeSourceNode,
  ],
};
