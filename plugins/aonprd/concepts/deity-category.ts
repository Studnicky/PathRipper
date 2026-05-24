// DeityCategory concept — Phase 6.4 taxonomic extraction.
//
// Delegates to Wave 5 slice helpers in deity-category.ts for correctness.
// DeityCategories.aspx pages describe pantheon groupings. Structure mirrors the
// standard AON entity page but introduces a non-standard `<h3 class="framing">
// Members</h3>` block harvested via DOM walking.
//
// Per-slice:
//   extract:deity-category-base     — identity + header scalars + sources
//   extract:deity-category-members  — linked deity refs from the Members block
//   extract:deity-category-aspects  — descriptive prose before the Members heading
//   finalize:deity-category         — assemble + strip raw_fields, attach meta
import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState }    from '../../../src/state/ScrapeState.js';
import type { RipperServices } from '../../../src/services/RipperServices.js';
import type { ConceptDecl, ConceptOutputBase } from '../taxonomy.js';
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
  htmlToText,
  extractEntityId,
  extractMetaDescription,
  extractMetaKeywords,
  stripStructuredKeys,
} from '../common.js';

// ─── Inlined from Wave 5: deity-category.ts ──────────────────────────────────
// ─── Output type ──────────────────────────────────────────────────────────────

/** A linked deity reference harvested from the Members section. */
export interface DeityCategoryMember {
  /** Display name of the deity link. */
  name:     string;
  /** AON Deities.aspx ID from `?ID=N`. */
  deity_id: number | null;
  /** Verbatim href. */
  href:     string;
}

export interface DeityCategoryOutputFields {
  url:                 string;
  /** Numeric AON DeityCategories.aspx ID from the URL query string. */
  deity_category_id:   number | null;
  name:                string;
  rarity:              Rarity;
  pfs:                 PfsLegality | null;
  legacy:              boolean;
  alt_edition_url:     string | null;
  traits:              string[];
  trait_ids:           Record<string, number>;
  source:              { book: string | null; page: number | null; source_id: number | null };
  sources:             SourceRef[];

  /** Deities listed under the `<h3 class="framing">Members</h3>` block. */
  members:             DeityCategoryMember[];
  /**
   * Descriptive prose describing the pantheon's aspects/themes — the text
   * between the Source line and the Members heading. Null when the page only
   * carries the Nethys placeholder note ("No official description was provided").
   */
  aspects:             string | null;

  // ─── Bookkeeping ───────────────────────────────────────────────────────────
  sections:            Section[];
  raw_fields:          Record<string, string>;
  links:               LinkRef[];
  body_text:           string;
  body_html:           string;
  meta_description:    string | null;
  meta_keywords:       string | null;
}

/** Full output shape — `_type` discriminator stamped by the router at chain entry. */
export type DeityCategoryOutput = ConceptOutputBase<'deity-category'> & DeityCategoryOutputFields;

// ─── Per-node slice types ─────────────────────────────────────────────────────

/** Fields owned by `extract-deity-category-base`. */
export interface DeityCategoryBaseSlice {
  url:               string;
  deity_category_id: number | null;
  name:              string;
  rarity:            Rarity;
  pfs:               PfsLegality | null;
  legacy:            boolean;
  alt_edition_url:   string | null;
  traits:            string[];
  trait_ids:         Record<string, number>;
  source:            DeityCategoryOutputFields['source'];
  sources:           SourceRef[];
}

/** Fields owned by `extract-deity-category-members`. */
export interface DeityCategoryMembersSlice {
  members: DeityCategoryMember[];
}

/** Fields owned by `extract-deity-category-aspects`. */
export interface DeityCategoryAspectsSlice {
  aspects: string | null;
}

/** Fields owned by `extract-deity-category-meta`. */
export interface DeityCategoryMetaSlice {
  __deity_category_meta_marked: true;
}

// ─── Members + aspects parsing (DOM-walking, no regex) ────────────────────────

/**
 * Locate the `<h3 class="framing">` Members heading and harvest every following
 * Deities.aspx anchor up to the closing of the content span. Uses cheerio DOM
 * walking rather than regex over the body HTML.
 */
function parseMembers($: CheerioAPI, target: CheerioNode): DeityCategoryMember[] {
  const out: DeityCategoryMember[] = [];
  const seen = new Set<string>();

  // Find the Members heading. AON uses a single h3.framing per page.
  const heading = target.find('h3.framing').filter((_, el) => {
    return $(el).text().trim().toLowerCase() === 'members';
  }).first();
  if (heading.length === 0) return out;

  // Walk forward siblings of the heading until end of the span, collecting any
  // <a href="Deities.aspx?ID=…"> anchors (each link is wrapped in `<u>` for
  // underline styling, but we just need the anchor).
  heading.nextAll('a[href*="Deities.aspx"]').each((_, el) => {
    const $a = $(el);
    const href = $a.attr('href') ?? '';
    if (href === '' || seen.has(href)) return;
    seen.add(href);
    const name = htmlToText($a.html() ?? '');
    const idMatch = /\?ID=(\d+)/i.exec(href);
    const deity_id = idMatch !== null ? parseInt(idMatch[1]!, 10) : null;
    out.push({ name, deity_id, href });
  });

  return out;
}

/**
 * Capture the prose between the Source line and the Members heading. The
 * canonical AON layout is `<h1>Name</h1><b>Source</b> … <br/>{prose}<h3>Members</h3>`
 * with the Source line living in the head fragment and the prose continuing in
 * `body_html`. We carve the body up to the Members marker and flatten to text.
 *
 * AON also emits a placeholder note for categories with no official description
 * (`<i>Note from Nethys: …</i>`) — we treat that as null aspects so consumers
 * can distinguish missing prose from real descriptions.
 */
function parseAspects(c: CommonExtraction): string | null {
  // Carve off everything before the Members heading; anchor-less h3.framing
  // markers are unique to deity-category pages.
  const cut = /<h3\b[^>]*class="[^"]*framing[^"]*"[^>]*>/i.exec(c.body_html);
  const before = cut !== null ? c.body_html.slice(0, cut.index) : c.body_html;
  const text = htmlToText(before).trim();
  if (text === '') return null;
  if (/^Note from Nethys:/i.test(text)) return null;
  return text;
}

// ─── Per-slice extraction helpers ─────────────────────────────────────────────

/** Extract base identity + header scalars for a deity-category page. */
export function extractDeityCategoryBase(c: CommonExtraction): DeityCategoryBaseSlice {
  return {
    url:               c.url,
    deity_category_id: extractEntityId(c.url),
    name:              c.title.name,
    rarity:            c.traits.rarity,
    pfs:               c.title.pfs,
    legacy:            c.title.legacy,
    alt_edition_url:   c.title.alt_edition_url,
    traits:            c.traits.traits,
    trait_ids:         c.traits.trait_ids,
    source:            { book: c.source.book, page: c.source.page, source_id: c.source.source_id },
    sources:           c.sources,
  };
}

/** Extract member deity links from the `<h3 class="framing">Members</h3>` block. */
export function extractDeityCategoryMembers($: CheerioAPI, target: CheerioNode): DeityCategoryMembersSlice {
  return { members: parseMembers($, target) };
}

/** Extract the descriptive prose (aspects) preceding the Members heading. */
export function extractDeityCategoryAspects(c: CommonExtraction): DeityCategoryAspectsSlice {
  return { aspects: parseAspects(c) };
}

/** Extract meta slice marker — sections/links/body/meta attach in finalize. */
export function extractDeityCategoryMeta(_c: CommonExtraction): DeityCategoryMetaSlice {
  return { __deity_category_meta_marked: true };
}

// ─── Finalize ────────────────────────────────────────────────────────────────

/** AON labels claimed by upstream deity-category slices. */
const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Source',
];

export function finalizeDeityCategory(
  c:        CommonExtraction,
  base:     DeityCategoryBaseSlice,
  members:  DeityCategoryMembersSlice,
  aspects:  DeityCategoryAspectsSlice,
  _meta:    DeityCategoryMetaSlice,
  $:        CheerioAPI,
  _target:  CheerioNode,
): DeityCategoryOutputFields {
  void _meta;
  void _target;
  const raw_fields = stripStructuredKeys(c.field_map, CLAIMED_FIELD_LABELS);
  return {
    ...base,
    members:          members.members,
    aspects:          aspects.aspects,
    sections:         c.sections,
    raw_fields,
    links:            c.links,
    body_text:        c.body_text,
    body_html:        c.body_html,
    meta_description: extractMetaDescription($),
    meta_keywords:    extractMetaKeywords($),
  } satisfies DeityCategoryOutputFields;
}

/**
 * Project a DeityCategories.aspx page into a typed DeityCategoryOutput.
 *
 * Thin assembly wrapper kept for `parseAonHtml` direct-call paths and unit
 * tests.
 */
export function extractDeityCategory(
  c:      CommonExtraction,
  $:      CheerioAPI,
  target: CheerioNode,
): DeityCategoryOutputFields {
  const base    = extractDeityCategoryBase(c);
  const members = extractDeityCategoryMembers($, target);
  const aspects = extractDeityCategoryAspects(c);
  const meta    = extractDeityCategoryMeta(c);
  return finalizeDeityCategory(c, base, members, aspects, meta, $, target);
}


// Re-export output type so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

// Node: extract:deity-category-base
// Identity + header scalars + sources.

export type DeityCategoryBaseOutput = 'success' | 'error';

export const deityCategoryBaseNode: NodeInterface<ScrapeState, DeityCategoryBaseOutput, RipperServices> = {
  name:    'extract:deity-category-base',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: DeityCategoryBaseOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const base = extractDeityCategoryBase(c);

    state.output = { ...state.output, ...base };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

// Node: extract:deity-category-members
// Linked deity references from the `<h3 class="framing">Members</h3>` block.
// Uses DOM walking (CheerioAPI + target) rather than regex over body HTML.

export type DeityCategoryMembersOutput = 'success' | 'error';

export const deityCategoryMembersNode: NodeInterface<ScrapeState, DeityCategoryMembersOutput, RipperServices> = {
  name:    'extract:deity-category-members',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCheerio', 'aonprdTarget'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: DeityCategoryMembersOutput }> {
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if ($ === undefined || target === undefined) return { output: 'error' };

    const members = extractDeityCategoryMembers($, target);

    state.output = { ...state.output, ...members };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

// Node: extract:deity-category-aspects
// Descriptive prose between the Source line and the Members heading.
// Null when the page only has a Nethys placeholder note.

export type DeityCategoryAspectsOutput = 'success' | 'error';

export const deityCategoryAspectsNode: NodeInterface<ScrapeState, DeityCategoryAspectsOutput, RipperServices> = {
  name:    'extract:deity-category-aspects',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: DeityCategoryAspectsOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const aspects = extractDeityCategoryAspects(c);

    state.output = { ...state.output, ...aspects };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

// Node: finalize:deity-category
// Assembles complete DeityCategoryOutput from all slices, strips claimed
// field-map keys, attaches sections, links, body_text/html, and meta tags.

export type FinalizeDeityCategoryOutput = 'success';

export const finalizeDeityCategoryNode: NodeInterface<ScrapeState, FinalizeDeityCategoryOutput, RipperServices> = {
  name:    'finalize:deity-category',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'aonprdTarget'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FinalizeDeityCategoryOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined || target === undefined) return { output: 'success' };
    const acc = (state.output ?? {}) as unknown as DeityCategoryOutput;
    const assembled = finalizeDeityCategory(c, (acc as never), (acc as never), (acc as never), (acc as never), $, target);
    setConceptOutput(state, assembled);

    return { output: 'success' };
  },
};

// ─── ConceptDecl export ───────────────────────────────────────────────────────

/**
 * DeityCategory concept declaration for the AONPRD taxonomy.
 * Imported by `plugins/aonprd/taxonomy/aonprd.ts`.
 *
 * The three extract nodes run in order — base → members → aspects — building
 * up state.output incrementally. The finalize node then recomputes the full
 * output from scratch so raw_fields sees the complete claimed-label picture.
 */
export const deityCategoryConcept: ConceptDecl<DeityCategoryOutput> = {
  id:       'deity-category',
  parent:   'entity',
  urlPaths: ['deitycategories'],
  capabilities: [
    deityCategoryBaseNode,
    deityCategoryMembersNode,
    deityCategoryAspectsNode,
    finalizeDeityCategoryNode,
  ],
  discriminator: { _type: 'deity-category' },
};
