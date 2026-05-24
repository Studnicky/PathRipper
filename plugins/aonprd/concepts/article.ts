//
// Article pages are prose-only entries; no structured improvements warranted
// beyond legacy-section filtering.
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
  type Section,
  type CheerioNode,
  type LinkRef,
  type Rarity,
  type PfsLegality,
  type SourceRef,
  extractMetaDescription,
  extractMetaKeywords,
  stripStructuredKeys,
  extractEntityId,
  filterLegacySections,
} from '../common.js';

// ─── Output type ─────────────────────────────────────────────────────────────
// ─── Output type ──────────────────────────────────────────────────────────────

export interface ArticleOutput {
  url:              string;
  /** Numeric AON Articles.aspx ID extracted from the URL query string. */
  article_id:       number | null;
  name:             string;
  rarity:           Rarity;
  pfs:              PfsLegality | null;
  legacy:           boolean;
  alt_edition_url:  string | null;
  traits:           string[];
  trait_ids:        Record<string, number>;
  source:           { book: string | null; page: number | null; source_id: number | null };
  sources:          SourceRef[];

  /** Prose description (the paragraph(s) following the Source line). */
  description:      string | null;

  // ─── Bookkeeping ───────────────────────────────────────────────────────────
  sections:         Section[];
  raw_fields:       Record<string, string>;
  links:            LinkRef[];
  body_text:        string;
  body_html:        string;
  /** `<meta name="description">` content. */
  meta_description: string | null;
  /** `<meta name="keywords">` content. */
  meta_keywords:    string | null;
}

// ─── Per-node slice types ─────────────────────────────────────────────────────

/** Fields owned by `extract-article-base`. */
export interface ArticleBaseSlice {
  url:             string;
  article_id:      number | null;
  name:            string;
  rarity:          Rarity;
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;
  traits:          string[];
  trait_ids:       Record<string, number>;
  source:          ArticleOutput['source'];
  sources:         SourceRef[];
}

/** Fields owned by `extract-article-content`. */
export interface ArticleContentSlice {
  description: string | null;
}

/** Fields owned by `extract-article-meta`. */
export interface ArticleMetaSlice {
  /** Marker so `state.output` accumulates the slice. */
  __article_meta_marked: true;
}

// ─── Per-slice extraction helpers ─────────────────────────────────────────────

/** Extract base identity + header scalars for an article page. */
export function extractArticleBase(c: CommonExtraction): ArticleBaseSlice {
  return {
    url:             c.url,
    article_id:      extractEntityId(c.url),
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

/** Extract the article description (body prose after the Source line). */
export function extractArticleContent(c: CommonExtraction): ArticleContentSlice {
  const text = c.body_text.trim();
  return { description: text === '' ? null : text };
}

/** Extract meta slice marker — sections/links/body/meta attach in finalize. */
export function extractArticleMeta(_c: CommonExtraction): ArticleMetaSlice {
  return { __article_meta_marked: true };
}

// ─── Finalize ────────────────────────────────────────────────────────────────

/**
 * AON labels claimed by upstream article slices. Article pages typically have
 * an empty `field_map` (Source is captured separately as a SourceRef) but we
 * strip the canonical labels defensively in case the underlying scaffolding
 * surfaces a `Source` key on legacy pages.
 */
const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Source',
];

export function finalizeArticle(
  c:        CommonExtraction,
  base:     ArticleBaseSlice,
  content:  ArticleContentSlice,
  _meta:    ArticleMetaSlice,
  $:        CheerioAPI,
  _target:  CheerioNode,
): ArticleOutput {
  void _meta;
  void _target;
  const raw_fields = stripStructuredKeys(c.field_map, CLAIMED_FIELD_LABELS);
  return {
    ...base,
    description:      content.description,
    sections:         c.sections,
    raw_fields,
    links:            c.links,
    body_text:        c.body_text,
    body_html:        c.body_html,
    meta_description: extractMetaDescription($),
    meta_keywords:    extractMetaKeywords($),
  } satisfies ArticleOutput;
}

/**
 * Project an Articles.aspx page into a typed ArticleOutput.
 *
 * Thin assembly wrapper kept for `parseAonHtml` direct-call paths and unit
 * tests. The DAG pipeline calls the per-slice helpers individually through
 * the decomposed article extraction nodes.
 */
export function extractArticle(
  c:      CommonExtraction,
  $:      CheerioAPI,
  target: CheerioNode,
): ArticleOutput {
  const base    = extractArticleBase(c);
  const content = extractArticleContent(c);
  const meta    = extractArticleMeta(c);
  return finalizeArticle(c, base, content, meta, $, target);
}

// Re-export output type so tests can import from here.
// ─── Helpers ─────────────────────────────────────────────────────────────────

/** AON labels claimed by article capability nodes. */

// ─── Capability nodes ─────────────────────────────────────────────────────────

export type ArticleBaseOutput = 'success' | 'error';

export const articleBaseNode: NodeInterface<ScrapeState, ArticleBaseOutput, RipperServices> = {
  name:    'extract:article-base',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: ArticleBaseOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const base    = extractArticleBase(c);
    const content = extractArticleContent(c);

    state.output = state.output !== null
      ? { ...state.output, ...base, ...content }
      : { ...base, ...content };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeArticleOutput = 'success';

export const finalizeArticleNode: NodeInterface<ScrapeState, FinalizeArticleOutput, RipperServices> = {
  name:    'finalize:article',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'sections'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FinalizeArticleOutput }> {
    const c        = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $        = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const sections = state.getMetadata<Section[]>('sections');
    if (c === undefined || $ === undefined || sections === undefined) return { output: 'success' };

    const raw_fields       = stripStructuredKeys(c.field_map, CLAIMED_FIELD_LABELS);
    const links            = c.links;
    const meta_description = extractMetaDescription($);
    const meta_keywords    = extractMetaKeywords($);

    state.output = state.output !== null
      ? {
        ...state.output,
        sections:         filterLegacySections(sections),
        raw_fields,
        links,
        body_text:        c.body_text,
        body_html:        c.body_html,
        meta_description,
        meta_keywords,
      }
      : {
        sections:         filterLegacySections(sections),
        raw_fields,
        links,
        body_text:        c.body_text,
        body_html:        c.body_html,
        meta_description,
        meta_keywords,
      };

    return { output: 'success' };
  },
};

// ─── ConceptDecl export ───────────────────────────────────────────────────────

export const articleConcept: ConceptDecl<ArticleOutput> = {
  id:       'article',
  parent:   'entity',
  urlPaths: ['articles'],
  capabilities: [
    articleBaseNode,
    finalizeArticleNode,
  ],
};
