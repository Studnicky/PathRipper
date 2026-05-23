// Contributor concept — Phase 6.4 taxonomic extraction.
//
// Delegates to the Wave 5 slice helpers in contributor.ts for correctness.
// Byte-equivalent to Wave 5 shape — contributor pages have minimal structured
// data; no improvements warranted beyond legacy-section filtering.
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

// ─── Inlined from Wave 5: contributor.ts ──────────────────────────────────
// ─── Output type ──────────────────────────────────────────────────────────────

export interface ContributorOutput {
  _type:            'contributor';
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
  _type:           'contributor';
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
  const re = /<b>([\s\S]*?)<\/b>([\s\S]*?)(?=<b>|<h[1-6]\b|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const label = htmlToText(m[1] ?? '').replace(/[:?]$/, '').trim();
    if (label === '') continue;
    const value = htmlToText(m[2] ?? '').replace(/^[\s;,:]+|[\s;,]+$/g, '');
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
  const re = /<b>\s*Email\s*<\/b>([\s\S]*?)(?=<b>|<h[1-6]\b|$)/i;
  const m = re.exec(head);
  if (m === null) return null;
  const value = m[1] ?? '';
  const mailto = /href=["']mailto:([^"']+)["']/i.exec(value);
  if (mailto !== null) return mailto[1]!.trim();
  const text = htmlToText(value).replace(/^[\s;,:]+|[\s;,]+$/g, '');
  return text === '' ? null : text;
}

/** Pull a website URL from the value HTML of an `<b>Website</b>` field. */
function pullWebsite(html: string): string | null {
  const headBoundary = /<h2\b/i.exec(html);
  const head = headBoundary !== null ? html.slice(0, headBoundary.index) : html;
  const re = /<b>\s*Web(?:site|page)\s*<\/b>([\s\S]*?)(?=<b>|<h[1-6]\b|$)/i;
  const m = re.exec(head);
  if (m === null) return null;
  const value = m[1] ?? '';
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

export function extractContributorBase(c: CommonExtraction): ContributorBaseSlice {
  return {
    _type:           'contributor',
    url:             c.url,
    contributor_id:  extractEntityId(c.url),
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

export function extractContributorProfile(
  _c:   CommonExtraction,
  $:    CheerioAPI,
  span: CheerioNode,
): ContributorProfileSlice {
  void $;
  void _c;
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
  c:       CommonExtraction,
  base:    ContributorBaseSlice,
  profile: ContributorProfileSlice,
  $:       CheerioAPI,
  _target: CheerioNode,
): ContributorOutput {
  void _target;
  const raw_fields = stripStructuredKeys(c.field_map, CLAIMED_FIELD_LABELS);
  return {
    ...base,
    title:            profile.title,
    email:            profile.email,
    location:         profile.location,
    website:          profile.website,
    bio_html:         profile.bio_html,
    bio_text:         profile.bio_text,
    sections:         c.sections,
    raw_fields,
    links:            c.links,
    body_text:        c.body_text,
    body_html:        c.body_html,
    meta_description: extractMetaDescription($),
    meta_keywords:    extractMetaKeywords($),
  } satisfies ContributorOutput;
}

/**
 * Project a Contributors.aspx page into a typed ContributorOutput.
 *
 * Thin assembly wrapper for `parseAonHtml` direct-call paths and unit tests.
 */
export function extractContributor(
  c:      CommonExtraction,
  $:      CheerioAPI,
  target: CheerioNode,
): ContributorOutput {
  const base    = extractContributorBase(c);
  const profile = extractContributorProfile(c, $, target);
  return finalizeContributor(c, base, profile, $, target);
}


// Re-export output type so tests can import from here.
// ─── Helpers ─────────────────────────────────────────────────────────────────

/** AON labels claimed by contributor capability nodes. */

// ─── Capability nodes ─────────────────────────────────────────────────────────

export type ContributorBaseOutput = 'success' | 'error';

export const contributorBaseNode: NodeInterface<ScrapeState, ContributorBaseOutput, RipperServices> = {
  name:    'extract:contributor-base',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: ContributorBaseOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const base = extractContributorBase(c);

    state.output = { ...state.output, ...base };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type ContributorProfileOutput = 'success' | 'error';

export const contributorProfileNode: NodeInterface<ScrapeState, ContributorProfileOutput, RipperServices> = {
  name:    'extract:contributor-profile',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'aonprdTarget'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: ContributorProfileOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined || target === undefined) return { output: 'error' };

    const profile = extractContributorProfile(c, $, target);

    state.output = { ...state.output, ...profile };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeContributorOutput = 'success';

export const finalizeContributorNode: NodeInterface<ScrapeState, FinalizeContributorOutput, RipperServices> = {
  name:    'finalize:contributor',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'sections'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FinalizeContributorOutput }> {
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

export const contributorConcept: ConceptDecl<ContributorOutput> = {
  id:       'contributor',
  parent:   'entity',
  urlPaths: ['contributors'],
  capabilities: [
    contributorBaseNode,
    contributorProfileNode,
    finalizeContributorNode,
  ],
  discriminator: { _type: 'contributor' },
};
