//
// DeityCategories.aspx pages describe pantheon groupings. Structure mirrors the
// standard AON entity page but introduces a non-standard `<h3 class="framing">
// Members</h3>` block harvested via DOM walking.
//
// Per-slice:
//   extract:deity-category-base     — identity + header scalars + sources
//   extract:deity-category-members  — linked deity refs from the Members block
//   extract:deity-category-aspects  — descriptive prose before the Members heading
//   finalize:deity-category         — assemble + strip raw_fields, attach meta
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState }    from '../../../src/state/ScrapeState.js';
import type { ConceptDecl } from '../../../src/taxonomy/Taxonomy.js';
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

export interface DeityCategoryOutput {
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
  source:            DeityCategoryOutput['source'];
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
function parseMembers(root: CheerioAPI, target: CheerioNode): DeityCategoryMember[] {
  const out: DeityCategoryMember[] = [];
  const seen = new Set<string>();

  // Find the Members heading. AON uses a single h3.framing per page.
  const heading = target.find('h3.framing').filter((_index, element) => {
    return root(element).text().trim().toLowerCase() === 'members';
  }).first();
  if (heading.length === 0) return out;

  // Walk forward siblings of the heading until end of the span, collecting any
  // <a href="Deities.aspx?ID=…"> anchors (each link is wrapped in `<u>` for
  // underline styling, but we just need the anchor).
  heading.nextAll('a[href*="Deities.aspx"]').each((_index, element) => {
    const $anchor = root(element);
    const href = $anchor.attr('href') ?? '';
    if (href === '' || seen.has(href)) return;
    seen.add(href);
    const name = htmlToText($anchor.html() ?? '');
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
function parseAspects(common: CommonExtraction): string | null {
  // Carve off everything before the Members heading; anchor-less h3.framing
  // markers are unique to deity-category pages.
  const cut = /<h3\b[^>]*class="[^"]*framing[^"]*"[^>]*>/i.exec(common.body_html);
  const before = cut !== null ? common.body_html.slice(0, cut.index) : common.body_html;
  const text = htmlToText(before).trim();
  if (text === '') return null;
  if (/^Note from Nethys:/i.test(text)) return null;
  return text;
}

// ─── Per-slice extraction helpers ─────────────────────────────────────────────

/** Extract base identity + header scalars for a deity-category page. */
export function extractDeityCategoryBase(common: CommonExtraction): DeityCategoryBaseSlice {
  return {
    url:               common.url,
    deity_category_id: extractEntityId(common.url),
    name:              common.title.name,
    rarity:            common.traits.rarity,
    pfs:               common.title.pfs,
    legacy:            common.title.legacy,
    alt_edition_url:   common.title.alt_edition_url,
    traits:            common.traits.traits,
    trait_ids:         common.traits.trait_ids,
    source:            { book: common.source.book, page: common.source.page, source_id: common.source.source_id },
    sources:           common.sources,
  };
}

/** Extract member deity links from the `<h3 class="framing">Members</h3>` block. */
export function extractDeityCategoryMembers(root: CheerioAPI, target: CheerioNode): DeityCategoryMembersSlice {
  return { members: parseMembers(root, target) };
}

/** Extract the descriptive prose (aspects) preceding the Members heading. */
export function extractDeityCategoryAspects(common: CommonExtraction): DeityCategoryAspectsSlice {
  return { aspects: parseAspects(common) };
}

/** Extract meta slice marker — sections/links/body/meta attach in finalize. */
export function extractDeityCategoryMeta(_common: CommonExtraction): DeityCategoryMetaSlice {
  return { __deity_category_meta_marked: true };
}

// ─── Finalize ────────────────────────────────────────────────────────────────

/** AON labels claimed by upstream deity-category slices. */
const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Source',
];

export function finalizeDeityCategory(
  common:   CommonExtraction,
  base:     DeityCategoryBaseSlice,
  members:  DeityCategoryMembersSlice,
  aspects:  DeityCategoryAspectsSlice,
  _meta:    DeityCategoryMetaSlice,
  root:     CheerioAPI,
  _target:  CheerioNode,
): DeityCategoryOutput {
  void _meta;
  void _target;
  const raw_fields = stripStructuredKeys(common.field_map, CLAIMED_FIELD_LABELS);
  return {
    ...base,
    members:          members.members,
    aspects:          aspects.aspects,
    sections:         common.sections,
    raw_fields,
    links:            common.links,
    body_text:        common.body_text,
    body_html:        common.body_html,
    meta_description: extractMetaDescription(root),
    meta_keywords:    extractMetaKeywords(root),
  } satisfies DeityCategoryOutput;
}

/**
 * Project a DeityCategories.aspx page into a typed DeityCategoryOutput.
 *
 * Thin assembly wrapper kept for `parseAonHtml` direct-call paths and unit
 * tests.
 */
export function extractDeityCategory(
  common:  CommonExtraction,
  root:    CheerioAPI,
  target:  CheerioNode,
): DeityCategoryOutput {
  const base    = extractDeityCategoryBase(common);
  const members = extractDeityCategoryMembers(root, target);
  const aspects = extractDeityCategoryAspects(common);
  const meta    = extractDeityCategoryMeta(common);
  return finalizeDeityCategory(common, base, members, aspects, meta, root, target);
}

// Re-export output type so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

// Node: extract:deity-category-base
// Identity + header scalars + sources.

export type DeityCategoryBaseOutput = 'success' | 'error';

class DeityCategoryBaseNodeImpl extends ScalarNode<ScrapeState, DeityCategoryBaseOutput> {
  public readonly name = 'extract:deity-category-base';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<DeityCategoryBaseOutput, SchemaObjectType> {
    return {
      success: {
        type: 'object',
        properties: {
          output: {
            type: 'object',
            properties: {
              url:               { type: 'string' },
              deity_category_id: { type: ['integer', 'null'] },
              name:              { type: 'string' },
              rarity:            { type: 'string' },
              pfs:               { type: ['string', 'null'] },
              legacy:            { type: 'boolean' },
              alt_edition_url:   { type: ['string', 'null'] },
              traits:            { type: 'array', items: { type: 'string' } },
              trait_ids:         { type: 'object' },
              source:            { type: 'object' },
              sources:           { type: 'array', items: { type: 'object' } },
            },
            required: ['url', 'name', 'rarity', 'traits', 'trait_ids', 'source', 'sources'],
          },
        },
        required: ['output'],
      },
      error: { type: 'object' },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<DeityCategoryBaseOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const base = extractDeityCategoryBase(common);

    state.output = { ...state.output, ...base };

    return NodeOutputBuilder.of('success');
  }
}
export const deityCategoryBaseNode = new DeityCategoryBaseNodeImpl();

// ─────────────────────────────────────────────────────────────────────────────

// Node: extract:deity-category-members
// Linked deity references from the `<h3 class="framing">Members</h3>` block.
// Uses DOM walking (CheerioAPI + target) rather than regex over body HTML.

export type DeityCategoryMembersOutput = 'success' | 'error';

class DeityCategoryMembersNodeImpl extends ScalarNode<ScrapeState, DeityCategoryMembersOutput> {
  public readonly name = 'extract:deity-category-members';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<DeityCategoryMembersOutput, SchemaObjectType> {
    return {
      success: {
        type: 'object',
        properties: {
          output: {
            type: 'object',
            properties: {
              members: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name:     { type: 'string' },
                    deity_id: { type: ['integer', 'null'] },
                    href:     { type: 'string' },
                  },
                  required: ['name', 'href'],
                },
              },
            },
            required: ['members'],
          },
        },
        required: ['output'],
      },
      error: { type: 'object' },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<DeityCategoryMembersOutput>> {
    const root   = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (root === undefined || target === undefined) return NodeOutputBuilder.of('error');

    const members = extractDeityCategoryMembers(root, target);

    state.output = { ...state.output, ...members };

    return NodeOutputBuilder.of('success');
  }
}
export const deityCategoryMembersNode = new DeityCategoryMembersNodeImpl();

// ─────────────────────────────────────────────────────────────────────────────

// Node: extract:deity-category-aspects
// Descriptive prose between the Source line and the Members heading.
// Null when the page only has a Nethys placeholder note.

export type DeityCategoryAspectsOutput = 'success' | 'error';

class DeityCategoryAspectsNodeImpl extends ScalarNode<ScrapeState, DeityCategoryAspectsOutput> {
  public readonly name = 'extract:deity-category-aspects';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<DeityCategoryAspectsOutput, SchemaObjectType> {
    return {
      success: {
        type: 'object',
        properties: {
          output: {
            type: 'object',
            properties: {
              aspects: { type: ['string', 'null'] },
            },
            required: ['aspects'],
          },
        },
        required: ['output'],
      },
      error: { type: 'object' },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<DeityCategoryAspectsOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const aspects = extractDeityCategoryAspects(common);

    state.output = { ...state.output, ...aspects };

    return NodeOutputBuilder.of('success');
  }
}
export const deityCategoryAspectsNode = new DeityCategoryAspectsNodeImpl();

// ─────────────────────────────────────────────────────────────────────────────

// Node: finalize:deity-category
// Assembles complete DeityCategoryOutput from all slices, strips claimed
// field-map keys, attaches sections, links, body_text/html, and meta tags.

export type FinalizeDeityCategoryOutput = 'success';

class FinalizeDeityCategoryNodeImpl extends ScalarNode<ScrapeState, FinalizeDeityCategoryOutput> {
  public readonly name = 'finalize:deity-category';
  public readonly outputs = ['success'] as const;

  public override get outputSchema(): Record<FinalizeDeityCategoryOutput, SchemaObjectType> {
    return {
      success: {
        type: 'object',
        properties: {
          output: { type: 'object' },
        },
        required: ['output'],
      },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<FinalizeDeityCategoryOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root   = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (common === undefined || root === undefined || target === undefined) return NodeOutputBuilder.of('success');
    const acc = (state.output ?? {}) as unknown as DeityCategoryOutput;
    const assembled = finalizeDeityCategory(common, (acc as never), (acc as never), (acc as never), (acc as never), root, target);
    setConceptOutput(state, assembled);

    return NodeOutputBuilder.of('success');
  }
}
export const finalizeDeityCategoryNode = new FinalizeDeityCategoryNodeImpl();

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
};
