//
// Two decomposed slices: base (identity + sources) and benefits
// (attribute boosts, trained skills, lore skills, granted feat, flavor,
// related sources), plus a finalize step for raw_fields + meta.
//
// a single taxonomy node rather than an inline switch arm.
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';
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
  htmlToText,
  extractEntityId,
  extractMetaDescription,
  extractMetaKeywords,
  stripStructuredKeys,
} from '../common.js';


// ─── Output shape ─────────────────────────────────────────────────────────────

export interface BackgroundOutput {
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
export function extractBackgroundBase(common: CommonExtraction, _root: CheerioAPI, _span: CheerioNode): BackgroundBaseSlice {
  void _root;
  void _span;
  return {
    url:             common.url,
    background_id:       extractEntityId(common.url),
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
export function extractBackgroundBenefits(common: CommonExtraction): BackgroundBenefitsSlice {
  let attribute_boost_choice: BackgroundBenefitsSlice['attribute_boost_choice'] = null;
  const boostMatch = /must be to ([A-Z][a-z]+)(?: or ([A-Z][a-z]+))?/.exec(common.body_text);
  if (boostMatch !== null) {
    const fixed = [boostMatch[1]!];
    if (boostMatch[2] !== undefined) fixed.push(boostMatch[2]);
    attribute_boost_choice = {
      fixed_options: fixed.filter((field) => ATTR_NAMES.includes(field)),
      free: /free attribute boost/i.test(common.body_text),
    };
  }

  const trained_skills: BackgroundBenefitsSlice['trained_skills'] = [];
  const lore_skills:    BackgroundBenefitsSlice['lore_skills']    = [];
  for (const link of common.links) {
    if (link.kind === 'Skills') {
      const entry = { name: link.text, skill_id: link.id };
      if (/lore/i.test(link.text)) lore_skills.push(entry);
      else trained_skills.push(entry);
    }
  }

  const featLink = common.links.find((link) => link.kind === 'Feats');
  const granted_feat = featLink === undefined
    ? null
    : { name: featLink.text, feat_id: featLink.id };

  const flavorIdx = common.body_text.search(/Choose (?:two|an) attribute/i);
  const flavor_text = flavorIdx === -1 ? common.body_text : common.body_text.slice(0, flavorIdx).trim();

  const related_sources: BackgroundBenefitsSlice['related_sources'] = [];
  const rsIdx = common.body_html.search(/<b>\s*Related Sources?\s*<\/b>/i);
  if (rsIdx !== -1) {
    const fragment = common.body_html.slice(rsIdx).replace(/^[\s\S]*?<\/b>\s*/, '').slice(0, 600);
    const anchorRe = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let anchorMatch: RegExpExecArray | null;
    while ((anchorMatch = anchorRe.exec(fragment)) !== null) {
      const href = anchorMatch[1] ?? '';
      if (!/Sources\.aspx/i.test(href)) continue;
      const idMatch = /\?ID=(\d+)/i.exec(href);
      const source_id = idMatch !== null ? parseInt(idMatch[1]!, 10) : null;
      const name = htmlToText(anchorMatch[2] ?? '');
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
  common:   CommonExtraction,
  base:     BackgroundBaseSlice,
  benefits: BackgroundBenefitsSlice,
  root:     CheerioAPI,
): BackgroundOutput {
  const raw_fields = stripStructuredKeys(common.field_map, CLAIMED_FIELD_LABELS);

  return {
    ...base,
    ...benefits,
    sections:         common.sections,
    raw_fields,
    links:            common.links,
    body_text:        common.body_text,
    body_html:        common.body_html,
    meta_description: extractMetaDescription(root),
    meta_keywords:    extractMetaKeywords(root),
  } satisfies BackgroundOutput;
}

/**
 * Extract a Pathfinder 2e background record from an AON Backgrounds.aspx page.
 *
 * Thin assembly wrapper kept for `parseAonHtml` direct-call paths and unit
 * tests. The DAG pipeline calls the per-slice helpers individually through
 * the decomposed background extraction nodes.
 */
export function extractBackground(common: CommonExtraction, root: CheerioAPI, span: CheerioNode): BackgroundOutput {
  const base     = extractBackgroundBase(common, root, span);
  const benefits = extractBackgroundBenefits(common);
  return finalizeBackground(common, base, benefits, root);
}

// Re-export output type so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

// Node: extract:background-base
// Identity + sources slice.

export type BackgroundBaseOutput = 'success' | 'error';

class BackgroundBaseNode extends ScalarNode<ScrapeState, BackgroundBaseOutput> {
  public readonly name = 'extract:background-base';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<BackgroundBaseOutput, SchemaObjectType> {
    return {
      success: {
        type: 'object',
        properties: {
          output: {
            type: 'object',
            properties: {
              url:             { type: 'string' },
              background_id:   { type: ['integer', 'null'] },
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
  ): Promise<NodeOutputType<BackgroundBaseOutput>> {
    const common  = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root    = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target  = state.getMetadata<CheerioNode>('aonprdTarget');
    if (common === undefined || root === undefined || target === undefined) return NodeOutputBuilder.of('error');

    const base = extractBackgroundBase(common, root, target);

    state.output = { ...state.output, ...base };

    return NodeOutputBuilder.of('success');
  }
}

export const backgroundBaseNode = new BackgroundBaseNode();

// ─────────────────────────────────────────────────────────────────────────────

// Node: extract:background-benefits
// Attribute boosts, trained/lore skills, granted feat, flavor, related sources.

export type BackgroundBenefitsOutput = 'success' | 'error';

class BackgroundBenefitsNode extends ScalarNode<ScrapeState, BackgroundBenefitsOutput> {
  public readonly name = 'extract:background-benefits';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<BackgroundBenefitsOutput, SchemaObjectType> {
    return {
      success: {
        type: 'object',
        properties: {
          output: {
            type: 'object',
            properties: {
              attribute_boost_choice: { type: ['object', 'null'] },
              trained_skills:         { type: 'array', items: { type: 'object' } },
              lore_skills:            { type: 'array', items: { type: 'object' } },
              granted_feat:           { type: ['object', 'null'] },
              flavor_text:            { type: 'string' },
              related_sources:        { type: 'array', items: { type: 'object' } },
            },
            required: ['trained_skills', 'lore_skills', 'flavor_text', 'related_sources'],
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
  ): Promise<NodeOutputType<BackgroundBenefitsOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const benefits = extractBackgroundBenefits(common);

    state.output = { ...state.output, ...benefits };

    return NodeOutputBuilder.of('success');
  }
}

export const backgroundBenefitsNode = new BackgroundBenefitsNode();

// ─────────────────────────────────────────────────────────────────────────────

// Node: finalize:background
// Assembles raw_fields + sections + meta tags.

export type FinalizeBackgroundOutput = 'success';

class FinalizeBackgroundNode extends ScalarNode<ScrapeState, FinalizeBackgroundOutput> {
  public readonly name = 'finalize:background';
  public readonly outputs = ['success'] as const;

  public override get outputSchema(): Record<FinalizeBackgroundOutput, SchemaObjectType> {
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
  ): Promise<NodeOutputType<FinalizeBackgroundOutput>> {
    const common  = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root    = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target  = state.getMetadata<CheerioNode>('aonprdTarget');
    if (common === undefined || root === undefined || target === undefined) return NodeOutputBuilder.of('success');
    const acc = (state.output ?? {}) as unknown as BackgroundOutput;
    const assembled = finalizeBackground(common, acc, acc, root);
    setConceptOutput(state, assembled);

    return NodeOutputBuilder.of('success');
  }
}

export const finalizeBackgroundNode = new FinalizeBackgroundNode();

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
};
