// Background concept — Phase 6.4 taxonomic extraction.
//
// Delegates to Wave 5 slice helpers in background.ts for correctness.
// Two decomposed slices: base (identity + sources) and benefits
// (attribute boosts, trained skills, lore skills, granted feat, flavor,
// related sources), plus a finalize step for raw_fields + meta.
//
// Improvement vs Wave 5: slices are individually composable; finalize is
// a single taxonomy node rather than an inline switch arm.
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
  htmlToText,
  extractEntityId,
  extractMetaDescription,
  extractMetaKeywords,
  stripStructuredKeys,
} from '../common.js';

// ─── Inlined from Wave 5: background.ts ──────────────────────────────────
// ─── Output shape ─────────────────────────────────────────────────────────────

export interface BackgroundOutput {
  _type:                   'background';
  url:                     string;
  background_id:               number | null;
  name:                    string;
  rarity:                  Rarity;
  pfs:                     PfsLegality | null;
  legacy:                  boolean;
  alt_edition_url:         string | null;
  traits:                  string[];
  trait_ids:               Record<string, number>;
  source:                  { book: string | null; page: number | null; source_id: number | null };
  sources:                 SourceRef[];
  sections:                Section[];
  raw_fields:              Record<string, string>;
  links:                   LinkRef[];
  body_text:               string;
  body_html:               string;
  meta_description:        string | null;
  meta_keywords:           string | null;
  attribute_boost_choice:  { fixed_options: string[]; free: boolean } | null;
  trained_skills:          Array<{ name: string; skill_id: number | null }>;
  lore_skills:             Array<{ name: string; skill_id: number | null }>;
  granted_feat:            { name: string; feat_id: number | null } | null;
  flavor_text:             string;
  /**
   * Related source books from the `<b>Related Sources</b>` field. These link
   * to Sources.aspx entries that feature this background.
   */
  related_sources:         Array<{ name: string; source_id: number | null }>;
}

// ─── Per-slice shapes ─────────────────────────────────────────────────────────

export interface BackgroundBaseSlice {
  _type:           'background';
  url:             string;
  background_id:       number | null;
  name:            string;
  rarity:          Rarity;
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;
  traits:          string[];
  trait_ids:       Record<string, number>;
  source:          { book: string | null; page: number | null; source_id: number | null };
  sources:         SourceRef[];
}

export interface BackgroundBenefitsSlice {
  attribute_boost_choice: { fixed_options: string[]; free: boolean } | null;
  trained_skills:         Array<{ name: string; skill_id: number | null }>;
  lore_skills:            Array<{ name: string; skill_id: number | null }>;
  granted_feat:           { name: string; feat_id: number | null } | null;
  flavor_text:            string;
  related_sources:        Array<{ name: string; source_id: number | null }>;
}

// ─── Known labels (for raw_fields strip) ──────────────────────────────────────

const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Source', 'Related Sources', 'Related Source',
];

const ATTR_NAMES = ['Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma'];

// ─── Slice extraction ─────────────────────────────────────────────────────────

/** Extract identity + source metadata. */
export function extractBackgroundBase(c: CommonExtraction, _$: CheerioAPI, _span: CheerioNode): BackgroundBaseSlice {
  void _$;
  void _span;
  return {
    _type:           'background',
    url:             c.url,
    background_id:       extractEntityId(c.url),
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

/**
 * Extract background-specific benefits from body content.
 *
 * Algorithm:
 *   - attribute_boost_choice: parse `must be to X (or Y)` from body_text plus
 *     check for `free attribute boost` phrasing.
 *   - trained_skills / lore_skills: walk c.links for Skills.aspx anchors and
 *     bucket by whether the link text contains "Lore".
 *   - granted_feat: first Feats.aspx anchor in the body.
 *   - flavor_text: prose preceding `Choose two/an attribute …` clause.
 *   - related_sources: Sources.aspx anchors inside the `<b>Related Sources</b>`
 *     inline field block.
 */
export function extractBackgroundBenefits(c: CommonExtraction): BackgroundBenefitsSlice {
  let attribute_boost_choice: BackgroundBenefitsSlice['attribute_boost_choice'] = null;
  const boostMatch = /must be to ([A-Z][a-z]+)(?: or ([A-Z][a-z]+))?/.exec(c.body_text);
  if (boostMatch !== null) {
    const fixed = [boostMatch[1]!];
    if (boostMatch[2] !== undefined) fixed.push(boostMatch[2]);
    attribute_boost_choice = {
      fixed_options: fixed.filter((f) => ATTR_NAMES.includes(f)),
      free: /free attribute boost/i.test(c.body_text),
    };
  }

  const trained_skills: BackgroundBenefitsSlice['trained_skills'] = [];
  const lore_skills:    BackgroundBenefitsSlice['lore_skills']    = [];
  for (const link of c.links) {
    if (link.kind === 'Skills') {
      const entry = { name: link.text, skill_id: link.id };
      if (/lore/i.test(link.text)) lore_skills.push(entry);
      else trained_skills.push(entry);
    }
  }

  const featLink = c.links.find((l) => l.kind === 'Feats');
  const granted_feat = featLink === undefined
    ? null
    : { name: featLink.text, feat_id: featLink.id };

  const flavorIdx = c.body_text.search(/Choose (?:two|an) attribute/i);
  const flavor_text = flavorIdx === -1 ? c.body_text : c.body_text.slice(0, flavorIdx).trim();

  const related_sources: BackgroundBenefitsSlice['related_sources'] = [];
  const rsIdx = c.body_html.search(/<b>\s*Related Sources?\s*<\/b>/i);
  if (rsIdx !== -1) {
    const fragment = c.body_html.slice(rsIdx).replace(/^[\s\S]*?<\/b>\s*/, '').slice(0, 600);
    const anchorRe = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let am: RegExpExecArray | null;
    while ((am = anchorRe.exec(fragment)) !== null) {
      const href = am[1] ?? '';
      if (!/Sources\.aspx/i.test(href)) continue;
      const idMatch = /\?ID=(\d+)/i.exec(href);
      const source_id = idMatch !== null ? parseInt(idMatch[1]!, 10) : null;
      const name = htmlToText(am[2] ?? '');
      if (name !== '') related_sources.push({ name, source_id });
    }
  }

  return {
    attribute_boost_choice,
    trained_skills,
    lore_skills,
    granted_feat,
    flavor_text,
    related_sources,
  };
}

/**
 * Assemble the final BackgroundOutput from per-slice results.
 *
 * `raw_fields` strips the source/related-sources labels claimed by the slices.
 */
export function finalizeBackground(
  c:        CommonExtraction,
  base:     BackgroundBaseSlice,
  benefits: BackgroundBenefitsSlice,
  $:        CheerioAPI,
): BackgroundOutput {
  const raw_fields = stripStructuredKeys(c.field_map, CLAIMED_FIELD_LABELS);

  return {
    ...base,
    ...benefits,
    sections:         c.sections,
    raw_fields,
    links:            c.links,
    body_text:        c.body_text,
    body_html:        c.body_html,
    meta_description: extractMetaDescription($),
    meta_keywords:    extractMetaKeywords($),
  } satisfies BackgroundOutput;
}

/**
 * Extract a Pathfinder 2e background record from an AON Backgrounds.aspx page.
 *
 * Thin assembly wrapper kept for `parseAonHtml` direct-call paths and unit
 * tests. The DAG pipeline calls the per-slice helpers individually through
 * the decomposed background extraction nodes.
 */
export function extractBackground(c: CommonExtraction, $: CheerioAPI, span: CheerioNode): BackgroundOutput {
  const base     = extractBackgroundBase(c, $, span);
  const benefits = extractBackgroundBenefits(c);
  return finalizeBackground(c, base, benefits, $);
}


// Re-export output type so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

// Node: extract:background-base
// Identity + sources slice.

export type BackgroundBaseOutput = 'success' | 'error';

export const backgroundBaseNode: NodeInterface<ScrapeState, BackgroundBaseOutput, RipperServices> = {
  name:    'extract:background-base',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'aonprdTarget'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: BackgroundBaseOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined || target === undefined) return { output: 'error' };

    const base = extractBackgroundBase(c, $, target);

    state.output = { ...state.output, ...base };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

// Node: extract:background-benefits
// Attribute boosts, trained/lore skills, granted feat, flavor, related sources.

export type BackgroundBenefitsOutput = 'success' | 'error';

export const backgroundBenefitsNode: NodeInterface<ScrapeState, BackgroundBenefitsOutput, RipperServices> = {
  name:    'extract:background-benefits',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: BackgroundBenefitsOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const benefits = extractBackgroundBenefits(c);

    state.output = { ...state.output, ...benefits };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

// Node: finalize:background
// Assembles raw_fields + sections + meta tags.

export type FinalizeBackgroundOutput = 'success';

export const finalizeBackgroundNode: NodeInterface<ScrapeState, FinalizeBackgroundOutput, RipperServices> = {
  name:    'finalize:background',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'aonprdTarget'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FinalizeBackgroundOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined || target === undefined) return { output: 'success' };
    const acc = (state.output ?? {}) as unknown as BackgroundOutput;
    const assembled = finalizeBackground(c, acc, acc, $);
    setConceptOutput(state, assembled);

    return { output: 'success' };
  },
};

// ─── ConceptDecl export ───────────────────────────────────────────────────────

/**
 * Background concept declaration for the AONPRD taxonomy.
 * Imported by `plugins/aonprd/taxonomy/aonprd.ts`.
 */
export const backgroundConcept: ConceptDecl<BackgroundOutput> = {
  id:       'background',
  parent:   'entity',
  urlPaths: ['backgrounds'],
  capabilities: [
    backgroundBaseNode,
    backgroundBenefitsNode,
    finalizeBackgroundNode,
  ],
  discriminator: { _type: 'background' },
};
