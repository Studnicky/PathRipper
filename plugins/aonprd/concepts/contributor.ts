//
// Contributor pages have minimal structured data; no improvements warranted
// beyond legacy-section filtering.
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState }    from '../../../src/state/ScrapeState.js';
import type { ConceptDecl } from '../taxonomy.js';
import {
  CAPABILITY_OUTPUTS,
  type CommonExtraction,
  type CheerioNode,
  type Section,
  type LinkRef,
  type Rarity,
  type PfsLegality,
  type SourceRef,
  extractMetaDescription,
  extractMetaKeywords,
  stripStructuredKeys,
  htmlToText,
  extractEntityId,
  filterLegacySections,
} from '../common.js';

// ─── Output type ─────────────────────────────────────────────────────────────

export interface ContributorOutput {
  url:              string;
  /** Numeric AON Contributors.aspx ID extracted from the URL query string. */
  contributor_id:   number | null;
  /** Display name from `<h1 class="title">`. */
  name:             string;
  rarity:           Rarity;
  pfs:              PfsLegality | null;
  legacy:           boolean;
  alt_edition_url:  string | null;
  traits:           string[];
  trait_ids:        Record<string, number>;
  source:           { book: string | null; page: number | null; source_id: number | null };
  sources:          SourceRef[];

  /** Role / title string from `<b>Title</b>`. */
  title:            string | null;
  /** Email address from `<b>Email</b>` (typically a `mailto:` anchor). */
  email:            string | null;
  /** Free-form location from `<b>Location</b>`. */
  location:         string | null;
  /** Personal website from `<b>Website</b>` (rare). */
  website:          string | null;
  /** Combined bio prose harvested from every `<h2 class="title">` section. */
  bio_html:         string;
  /** Plain-text projection of `bio_html`. */
  bio_text:         string;

  // ─── Bookkeeping ───────────────────────────────────────────────────────────
  sections:         Section[];
  raw_fields:       Record<string, string>;
  links:            LinkRef[];
  body_text:        string;
  body_html:        string;
  meta_description: string | null;
  meta_keywords:    string | null;
}

// ─── Per-node slice types ─────────────────────────────────────────────────────

export interface ContributorBaseSlice {
  url:             string;
  contributor_id:  number | null;
  name:            string;
  rarity:          Rarity;
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;
  traits:          string[];
  trait_ids:       Record<string, number>;
  source:          ContributorOutput['source'];
  sources:         SourceRef[];
}

export interface ContributorProfileSlice {
  title:    string | null;
  email:    string | null;
  location: string | null;
  website:  string | null;
  bio_html: string;
  bio_text: string;
}

export interface ContributorMetaSlice {
  __contributor_meta_marked: true;
}

// ─── Bold-label harvest ──────────────────────────────────────────────────────

/**
 * Harvest `<b>Label</b> Value` pairs from a fragment up to the next `<b>`
 * label, `<h{1,6}>`, or end of input. Mirrors the deity-page label harvester
 * but tolerates inline `;` separators between fields on the same line.
 */
function harvestBoldLabels(html: string): Map<string, string> {
  const out = new Map<string, string>();
  const regex = /<b>([\s\S]*?)<\/b>([\s\S]*?)(?=<b>|<h[1-6]\b|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const label = htmlToText(match[1] ?? '').replace(/[:?]$/, '').trim();
    if (label === '') continue;
    const value = htmlToText(match[2] ?? '').replace(/^[\s;,:]+|[\s;,]+$/g, '');
    if (value === '') continue;
    const key = label.toLowerCase();
    if (!out.has(key)) out.set(key, value);
  }
  return out;
}

/** Pull a mailto: address from the value HTML of an `<b>Email</b>` field. */
function pullEmail(html: string): string | null {
  // The header row sits between the page-title <h1> and the first <h2>.
  const headBoundary = /<h2\b/i.exec(html);
  const head = headBoundary !== null ? html.slice(0, headBoundary.index) : html;
  const regex = /<b>\s*Email\s*<\/b>([\s\S]*?)(?=<b>|<h[1-6]\b|$)/i;
  const match = regex.exec(head);
  if (match === null) return null;
  const value = match[1] ?? '';
  const mailto = /href=["']mailto:([^"']+)["']/i.exec(value);
  if (mailto !== null) return mailto[1]!.trim();
  const text = htmlToText(value).replace(/^[\s;,:]+|[\s;,]+$/g, '');
  return text === '' ? null : text;
}

/** Pull a website URL from the value HTML of an `<b>Website</b>` field. */
function pullWebsite(html: string): string | null {
  const headBoundary = /<h2\b/i.exec(html);
  const head = headBoundary !== null ? html.slice(0, headBoundary.index) : html;
  const regex = /<b>\s*Web(?:site|page)\s*<\/b>([\s\S]*?)(?=<b>|<h[1-6]\b|$)/i;
  const match = regex.exec(head);
  if (match === null) return null;
  const value = match[1] ?? '';
  const hrefMatch = /href=["']([^"']+)["']/i.exec(value);
  if (hrefMatch !== null) return hrefMatch[1]!.trim();
  const text = htmlToText(value).replace(/^[\s;,:]+|[\s;,]+$/g, '');
  return text === '' ? null : text;
}

/**
 * Extract bio prose: everything inside the content span from the first
 * `<h2 class="title">` onward, with the page-title `<h1>` and header row
 * removed.
 */
function extractBio(spanHtml: string): { html: string; text: string } {
  const cut = /<h2\b[^>]*class="[^"]*title[^"]*"[^>]*>/i.exec(spanHtml);
  if (cut === null) return { html: '', text: '' };
  const html = spanHtml.slice(cut.index).trim();
  return { html, text: htmlToText(html) };
}

// ─── Per-slice extraction helpers ─────────────────────────────────────────────

export function extractContributorBase(common: CommonExtraction): ContributorBaseSlice {
  return {
    url:             common.url,
    contributor_id:  extractEntityId(common.url),
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

export function extractContributorProfile(
  _common: CommonExtraction,
  root:    CheerioAPI,
  span:    CheerioNode,
): ContributorProfileSlice {
  void root;
  void _common;
  const spanHtml = span.html() ?? '';

  // Header row labels live before the first <h2 class="title">.
  const headBoundary = /<h2\b/i.exec(spanHtml);
  const head = headBoundary !== null ? spanHtml.slice(0, headBoundary.index) : spanHtml;
  const map = harvestBoldLabels(head);

  const bio = extractBio(spanHtml);

  return {
    title:    map.get('title')    ?? null,
    email:    pullEmail(spanHtml),
    location: map.get('location') ?? null,
    website:  pullWebsite(spanHtml),
    bio_html: bio.html,
    bio_text: bio.text,
  };
}

// ─── Finalize ────────────────────────────────────────────────────────────────

const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Source',
  'Title',
  'Email',
  'Location',
  'Website',
  'Webpage',
];

export function finalizeContributor(
  common:  CommonExtraction,
  base:    ContributorBaseSlice,
  profile: ContributorProfileSlice,
  root:    CheerioAPI,
  _target: CheerioNode,
): ContributorOutput {
  void _target;
  const raw_fields = stripStructuredKeys(common.field_map, CLAIMED_FIELD_LABELS);
  return {
    ...base,
    title:            profile.title,
    email:            profile.email,
    location:         profile.location,
    website:          profile.website,
    bio_html:         profile.bio_html,
    bio_text:         profile.bio_text,
    sections:         common.sections,
    raw_fields,
    links:            common.links,
    body_text:        common.body_text,
    body_html:        common.body_html,
    meta_description: extractMetaDescription(root),
    meta_keywords:    extractMetaKeywords(root),
  } satisfies ContributorOutput;
}

/**
 * Project a Contributors.aspx page into a typed ContributorOutput.
 *
 * Thin assembly wrapper for `parseAonHtml` direct-call paths and unit tests.
 */
export function extractContributor(
  common:  CommonExtraction,
  root:    CheerioAPI,
  target:  CheerioNode,
): ContributorOutput {
  const base    = extractContributorBase(common);
  const profile = extractContributorProfile(common, root, target);
  return finalizeContributor(common, base, profile, root, target);
}

// Re-export output type so tests can import from here.
// ─── Helpers ─────────────────────────────────────────────────────────────────

/** AON labels claimed by contributor capability nodes. */

// ─── Capability nodes ─────────────────────────────────────────────────────────

export type ContributorBaseOutput = 'success' | 'error';

class ContributorBaseNode extends ScalarNode<ScrapeState, ContributorBaseOutput> {
  public readonly name = 'extract:contributor-base';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<ContributorBaseOutput, SchemaObjectType> {
    return {
      success: {
        type: 'object',
        properties: {
          output: {
            type: 'object',
            properties: {
              url:             { type: 'string' },
              contributor_id:  { type: ['integer', 'null'] },
              name:            { type: 'string' },
              rarity:          { type: 'string' },
              pfs:             { type: ['string', 'null'] },
              legacy:          { type: 'boolean' },
              alt_edition_url: { type: ['string', 'null'] },
              traits:          { type: 'array', items: { type: 'string' } },
              trait_ids:       { type: 'object' },
              source:          { type: 'object' },
              sources:         { type: 'array', items: { type: 'object' } },
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
  ): Promise<NodeOutputType<ContributorBaseOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const base = extractContributorBase(common);

    state.output = { ...state.output, ...base };

    return NodeOutputBuilder.of('success');
  }
}

export const contributorBaseNode = new ContributorBaseNode();

// ─────────────────────────────────────────────────────────────────────────────

export type ContributorProfileOutput = 'success' | 'error';

class ContributorProfileNode extends ScalarNode<ScrapeState, ContributorProfileOutput> {
  public readonly name = 'extract:contributor-profile';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<ContributorProfileOutput, SchemaObjectType> {
    return {
      success: {
        type: 'object',
        properties: {
          output: {
            type: 'object',
            properties: {
              title:    { type: ['string', 'null'] },
              email:    { type: ['string', 'null'] },
              location: { type: ['string', 'null'] },
              website:  { type: ['string', 'null'] },
              bio_html: { type: 'string' },
              bio_text: { type: 'string' },
            },
            required: ['bio_html', 'bio_text'],
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
  ): Promise<NodeOutputType<ContributorProfileOutput>> {
    const common  = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root    = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target  = state.getMetadata<CheerioNode>('aonprdTarget');
    if (common === undefined || root === undefined || target === undefined) return NodeOutputBuilder.of('error');

    const profile = extractContributorProfile(common, root, target);

    state.output = { ...state.output, ...profile };

    return NodeOutputBuilder.of('success');
  }
}

export const contributorProfileNode = new ContributorProfileNode();

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeContributorOutput = 'success';

class FinalizeContributorNode extends ScalarNode<ScrapeState, FinalizeContributorOutput> {
  public readonly name = 'finalize:contributor';
  public readonly outputs = ['success'] as const;

  public override get outputSchema(): Record<FinalizeContributorOutput, SchemaObjectType> {
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
  ): Promise<NodeOutputType<FinalizeContributorOutput>> {
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

export const finalizeContributorNode = new FinalizeContributorNode();

// ─── ConceptDecl export ───────────────────────────────────────────────────────

export const contributorConcept: ConceptDecl<ContributorOutput> = {
  id:       'contributor',
  parent:   'entity',
  urlPaths: ['contributors'],
  capabilities: [
    contributorBaseNode,
    contributorProfileNode,
    finalizeContributorNode,
  ],
};
