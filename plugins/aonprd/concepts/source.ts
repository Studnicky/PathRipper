// Source concept — Phase 6.4 taxonomic extraction.
//
// Source pages (Sources.aspx) are book metadata entries: product page URL,
// release date, product line, source group, errata version, and an extensive
// catalog of every entity sourced from that book organized by h2 category
// headings. This concept delegates to the Wave 5 slice helpers in source.ts
// for correctness; output is byte-equivalent to the Wave 5 baseline.
//
// Improvement vs Wave 5: no bespoke node-folder; capabilities are co-located
// in this file with inline contracts.
import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState }    from '../../../src/state/ScrapeState.js';
import type { RipperServices } from '../../../src/services/RipperServices.js';
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

// ─── Inlined from Wave 5: source.ts ──────────────────────────────────
// ─── Output type ──────────────────────────────────────────────────────────────

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
  _type:               'source';
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
  _type:           'source';
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
function extractFieldHref(c: CommonExtraction, label: string): string | null {
  for (const f of c.fields) {
    if (f.label.toLowerCase() !== label.toLowerCase()) continue;
    const m = /href="([^"]+)"/i.exec(f.value_html);
    if (m !== null) return m[1]!;
    const text = htmlToText(f.value_html).trim();
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
function parseRelated($: CheerioAPI, target: CheerioNode): SourceRelated[] {
  const out: SourceRelated[] = [];
  const seen = new Set<string>();

  target.find('h2.title').each((_, el) => {
    const $h = $(el);
    const headingRaw = $h.text().replace(/\s+/g, ' ').trim();
    if (headingRaw === '') return;
    // Strip trailing "[N]" entity count for a clean category label.
    const category = headingRaw.replace(/\s*\[\d+\]\s*$/, '').trim();
    if (category === '') return;

    // Collect anchors between this heading and the next h2/h3.
    let cur = ($h.get(0) as { next: { tagName?: string; type: string } | null } | undefined)?.next ?? null;
    while (cur !== null) {
      // Cheerio's Element typings vary; cast to a minimal shape for traversal.
      const node = cur as unknown as { type: string; tagName?: string; next: unknown };
      if (node.type === 'tag') {
        const tag = (node.tagName ?? '').toLowerCase();
        if (tag === 'h2' || tag === 'h3' || tag === 'h1') break;
      }
      // Collect every anchor reachable from this node.
      const $wrapper = $(cur as unknown as Parameters<typeof $>[0]);
      $wrapper.find('a[href]').addBack('a[href]').each((__, a) => {
        const $a = $(a);
        const href = $a.attr('href') ?? '';
        if (href === '') return;
        const aspxMatch = /([A-Za-z][A-Za-z0-9]*)\.aspx/.exec(href);
        if (aspxMatch === null) return;
        const kind = aspxMatch[1]!;
        const idMatch = /\?ID=(\d+)/i.exec(href);
        const aon_id = idMatch !== null ? parseInt(idMatch[1]!, 10) : null;
        const name = htmlToText($a.html() ?? '');
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
export function extractSourceBase(c: CommonExtraction): SourceBaseSlice {
  return {
    _type:           'source',
    url:             c.url,
    source_id:       extractEntityId(c.url),
    name:            c.title.name,
    rarity:          c.traits.rarity,
    pfs:             c.title.pfs,
    legacy:          c.title.legacy,
    alt_edition_url: c.title.alt_edition_url,
    traits:          c.traits.traits,
    trait_ids:       c.traits.trait_ids,
    source:          { book: c.source.book, page: c.source.page, source_id: c.source.source_id },
    sources:         c.sources,
  };
}

/** Extract the four product-metadata fields plus optional errata version. */
export function extractSourceMetadata(c: CommonExtraction): SourceMetadataSlice {
  return {
    product_page:  extractFieldHref(c, 'Product Page'),
    release_date:  getField(c, 'Release Date'),
    product_line:  getField(c, 'Product Line'),
    source_group:  getField(c, 'Source Group'),
    latest_errata: getField(c, 'Latest Errata'),
  };
}

/** Extract catalog cross-references from the `<h2 class="title">` sections. */
export function extractSourceRelated($: CheerioAPI, target: CheerioNode): SourceRelatedSlice {
  return { related_sources: parseRelated($, target) };
}

/** Extract meta slice marker — sections/links/body/meta attach in finalize. */
export function extractSourceMeta(_c: CommonExtraction): SourceMetaSlice {
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
  c:         CommonExtraction,
  base:      SourceBaseSlice,
  metadata:  SourceMetadataSlice,
  related:   SourceRelatedSlice,
  _meta:     SourceMetaSlice,
  $:         CheerioAPI,
  _target:   CheerioNode,
): SourceOutput {
  void _meta;
  void _target;
  const raw_fields = stripStructuredKeys(c.field_map, CLAIMED_FIELD_LABELS);
  return {
    ...base,
    product_page:     metadata.product_page,
    release_date:     metadata.release_date,
    product_line:     metadata.product_line,
    source_group:     metadata.source_group,
    latest_errata:    metadata.latest_errata,
    related_sources:  related.related_sources,
    sections:         c.sections,
    raw_fields,
    // Sources.aspx has no `<hr/>` separator so `body_html` is empty after the
    // shared `splitOnHr` fallback — fall back to the canonical span-wide link
    // harvest so catalog anchors aren't dropped.
    links:            c.links,
    body_text:        c.body_text,
    body_html:        c.body_html,
    meta_description: extractMetaDescription($),
    meta_keywords:    extractMetaKeywords($),
  } satisfies SourceOutput;
}

/**
 * Project a Sources.aspx page into a typed SourceOutput.
 *
 * Thin assembly wrapper kept for `parseAonHtml` direct-call paths and unit
 * tests.
 */
export function extractSource(
  c:      CommonExtraction,
  $:      CheerioAPI,
  target: CheerioNode,
): SourceOutput {
  const base     = extractSourceBase(c);
  const metadata = extractSourceMetadata(c);
  const related  = extractSourceRelated($, target);
  const meta     = extractSourceMeta(c);
  return finalizeSource(c, base, metadata, related, meta, $, target);
}


// Re-export output type so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

export type SourceBaseOutput = 'success' | 'error';

export const sourceBaseNode: NodeInterface<ScrapeState, SourceBaseOutput, RipperServices> = {
  name:    'extract:source-base',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: SourceBaseOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const base = extractSourceBase(c);

    state.output = { ...state.output, ...base };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type SourceMetadataOutput = 'success' | 'error';

export const sourceMetadataNode: NodeInterface<ScrapeState, SourceMetadataOutput, RipperServices> = {
  name:    'extract:source-metadata',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: SourceMetadataOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const metadata = extractSourceMetadata(c);

    state.output = { ...state.output, ...metadata };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type SourceRelatedOutput = 'success' | 'error';

export const sourceRelatedNode: NodeInterface<ScrapeState, SourceRelatedOutput, RipperServices> = {
  name:    'extract:source-related',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCheerio', 'aonprdTarget'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: SourceRelatedOutput }> {
    const $ = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if ($ === undefined || target === undefined) return { output: 'error' };

    const related = extractSourceRelated($, target);

    state.output = { ...state.output, ...related };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeSourceOutput = 'success';

export const finalizeSourceNode: NodeInterface<ScrapeState, FinalizeSourceOutput, RipperServices> = {
  name:    'finalize:source',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'aonprdTarget'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FinalizeSourceOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined || target === undefined) return { output: 'success' };

    // Pass a meta marker inline — finalizeSource ignores it (void _meta).
    const meta     = { __source_meta_marked: true as const };
    const acc = (state.output ?? {}) as unknown as SourceOutput;
    const assembled = finalizeSource(c, acc, acc, acc, meta, $, target);
    setConceptOutput(state, assembled);

    return { output: 'success' };
  },
};

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
  discriminator: { _type: 'source' },
};
