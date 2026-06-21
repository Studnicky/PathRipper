//
// Article pages are prose-only entries; no structured improvements warranted
// beyond legacy-section filtering.
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState }    from '../../../src/state/ScrapeState.js';
import type { ConceptDecl } from '../taxonomy.js';
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
export function extractArticleBase(common: CommonExtraction): ArticleBaseSlice {
  return {
    url:             common.url,
    article_id:      extractEntityId(common.url),
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

/** Extract the article description (body prose after the Source line). */
export function extractArticleContent(common: CommonExtraction): ArticleContentSlice {
  const text = common.body_text.trim();
  return { description: text === '' ? null : text };
}

/** Extract meta slice marker — sections/links/body/meta attach in finalize. */
export function extractArticleMeta(_common: CommonExtraction): ArticleMetaSlice {
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
  common:   CommonExtraction,
  base:     ArticleBaseSlice,
  content:  ArticleContentSlice,
  _meta:    ArticleMetaSlice,
  root:     CheerioAPI,
  _target:  CheerioNode,
): ArticleOutput {
  void _meta;
  void _target;
  const raw_fields = stripStructuredKeys(common.field_map, CLAIMED_FIELD_LABELS);
  return {
    ...base,
    description:      content.description,
    sections:         common.sections,
    raw_fields,
    links:            common.links,
    body_text:        common.body_text,
    body_html:        common.body_html,
    meta_description: extractMetaDescription(root),
    meta_keywords:    extractMetaKeywords(root),
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
  common:  CommonExtraction,
  root:    CheerioAPI,
  target:  CheerioNode,
): ArticleOutput {
  const base    = extractArticleBase(common);
  const content = extractArticleContent(common);
  const meta    = extractArticleMeta(common);
  return finalizeArticle(common, base, content, meta, root, target);
}

// Re-export output type so tests can import from here.
// ─── Helpers ─────────────────────────────────────────────────────────────────

/** AON labels claimed by article capability nodes. */

// ─── Capability nodes ─────────────────────────────────────────────────────────

export type ArticleBaseOutput = 'success' | 'error';

class ArticleBaseNodeImpl extends ScalarNode<ScrapeState, ArticleBaseOutput> {
  public readonly name    = 'extract:article-base';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<ArticleBaseOutput, SchemaObjectType> {
    return {
      success: {
        type: 'object',
        properties: {
          output: {
            type: 'object',
            properties: {
              url:             { type: 'string' },
              article_id:      { type: ['integer', 'null'] },
              name:            { type: 'string' },
              rarity:          { type: 'string' },
              pfs:             { type: ['string', 'null'] },
              legacy:          { type: 'boolean' },
              alt_edition_url: { type: ['string', 'null'] },
              traits:          { type: 'array', items: { type: 'string' } },
              trait_ids:       { type: 'object' },
              source:          { type: 'object' },
              sources:         { type: 'array', items: { type: 'object' } },
              description:     { type: ['string', 'null'] },
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
  ): Promise<NodeOutputType<ArticleBaseOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const base    = extractArticleBase(common);
    const content = extractArticleContent(common);

    state.output = state.output !== null
      ? { ...state.output, ...base, ...content }
      : { ...base, ...content };

    return NodeOutputBuilder.of('success');
  }
}
export const articleBaseNode = new ArticleBaseNodeImpl();

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeArticleOutput = 'success';

class FinalizeArticleNodeImpl extends ScalarNode<ScrapeState, FinalizeArticleOutput> {
  public readonly name    = 'finalize:article';
  public readonly outputs = ['success'] as const;

  public override get outputSchema(): Record<FinalizeArticleOutput, SchemaObjectType> {
    return {
      // `success` — merges sections, raw_fields, links, body_text, body_html, meta into state.output (no setConceptOutput call).
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
  ): Promise<NodeOutputType<FinalizeArticleOutput>> {
    const common   = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root     = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const sections = state.getMetadata<Section[]>('sections');
    if (common === undefined || root === undefined || sections === undefined) return NodeOutputBuilder.of('success');

    const raw_fields       = stripStructuredKeys(common.field_map, CLAIMED_FIELD_LABELS);
    const links            = common.links;
    const meta_description = extractMetaDescription(root);
    const meta_keywords    = extractMetaKeywords(root);

    state.output = state.output !== null
      ? {
        ...state.output,
        sections:         filterLegacySections(sections),
        raw_fields,
        links,
        body_text:        common.body_text,
        body_html:        common.body_html,
        meta_description,
        meta_keywords,
      }
      : {
        sections:         filterLegacySections(sections),
        raw_fields,
        links,
        body_text:        common.body_text,
        body_html:        common.body_html,
        meta_description,
        meta_keywords,
      };

    return NodeOutputBuilder.of('success');
  }
}
export const finalizeArticleNode = new FinalizeArticleNodeImpl();

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
