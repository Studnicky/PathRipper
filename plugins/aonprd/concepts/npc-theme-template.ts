//
// Two decomposed slices: base (identity + sources) and traits-mods (flavor
// blurb + All Creatures baseline + per-tier level benefits). Finalize
// assembles raw_fields + meta.
//
// is a first-class slice rather than being embedded inside a monolithic
// finalize function.
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';
import type { OperationContractFragmentType } from '@studnicky/dagonizer/contracts';
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

// ─── Output type ─────────────────────────────────────────────────────────────
// ─── Output type ──────────────────────────────────────────────────────────────

/** A single level-tiered benefit entry (1st, 4th, 7th, 12th, 17th, …). */
export interface NpcThemeTemplateTier {
  /** Minimum creature level the benefit applies at. */
  level:     number;
  /** Verbatim heading text — "1st Level or Higher", etc. */
  label:     string;
  /** Plain-text body of the benefit. */
  text:      string;
  /** Verbatim HTML body — preserves anchors for downstream linking. */
  text_html: string;
}

export interface NpcThemeTemplateOutput {
  url:                    string;
  /** Numeric AON NPCThemeTemplates.aspx ID extracted from the URL query string. */
  npc_theme_template_id:  number | null;
  name:                   string;
  rarity:                 Rarity;
  pfs:                    PfsLegality | null;
  legacy:                 boolean;
  alt_edition_url:        string | null;
  traits:                 string[];
  trait_ids:              Record<string, number>;
  source:                 { book: string | null; page: number | null; source_id: number | null };
  sources:                SourceRef[];

  // ─── Traits / modifications ───────────────────────────────────────────────
  /** Italic flavor sentence after the `<b>Source</b>` line, before any tier label. */
  flavor:                  string | null;
  /** "All Creatures" baseline modification text, when present. */
  all_creatures:           { text: string; text_html: string } | null;
  /** Per-tier benefits indexed by minimum creature level. */
  tiers:                   NpcThemeTemplateTier[];

  // ─── Bookkeeping ──────────────────────────────────────────────────────────
  sections:                Section[];
  raw_fields:              Record<string, string>;
  links:                   LinkRef[];
  body_text:               string;
  body_html:               string;
  /** `<meta name="description">` content. */
  meta_description:        string | null;
  /** `<meta name="keywords">` content. */
  meta_keywords:           string | null;
}

// ─── Per-node slice types ─────────────────────────────────────────────────────

/** Fields owned by `extract-npc-theme-template-base`. */
export interface NpcThemeTemplateBaseSlice {
  url:                   string;
  npc_theme_template_id: number | null;
  name:                  string;
  rarity:                Rarity;
  pfs:                   PfsLegality | null;
  legacy:                boolean;
  alt_edition_url:       string | null;
  traits:                string[];
  trait_ids:             Record<string, number>;
  source:                NpcThemeTemplateOutput['source'];
  sources:               SourceRef[];
}

/** Fields owned by `extract-npc-theme-template-traits-mods`. */
export interface NpcThemeTemplateTraitsModsSlice {
  flavor:        string | null;
  all_creatures: { text: string; text_html: string } | null;
  tiers:         NpcThemeTemplateTier[];
}

/** Fields owned by `extract-npc-theme-template-meta`. */
export interface NpcThemeTemplateMetaSlice {
  /** Marker so `state.output` accumulates the slice. */
  __npc_theme_template_meta_marked: true;
}

// ─── Body parsing ────────────────────────────────────────────────────────────

const TIER_LABEL_RE = /^(\d+)(?:st|nd|rd|th)\s+Level\s+or\s+Higher$/i;

/**
 * Walk the body HTML in source order and pair each `<b>Label</b>` with the
 * text up to the next `<b>` or end of fragment. Returns `[label, valueHtml]`
 * tuples preserving original ordering — tier order matters in output.
 */
function harvestOrderedBoldPairs(html: string): Array<{ label: string; valueHtml: string }> {
  const out: Array<{ label: string; valueHtml: string }> = [];
  const regex = /<b>([\s\S]*?)<\/b>([\s\S]*?)(?=<b>|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const labelHtml = match[1] ?? '';
    const valueHtml = match[2] ?? '';
    const label = htmlToText(labelHtml).replace(/[:?]$/, '').trim();
    if (label === '') continue;
    out.push({ label, valueHtml });
  }
  return out;
}

/** Clean a label value by stripping leading `:` / `;` / `,` and trimming. */
function cleanValueText(valueHtml: string): string {
  return htmlToText(valueHtml).replace(/^[\s;,:]+|[\s;,]+$/g, '');
}

/** Clean a label value HTML by stripping a leading `:` / whitespace. */
function cleanValueHtml(valueHtml: string): string {
  return valueHtml.replace(/^\s*[:;,]\s*/, '').trim();
}

// ─── Per-slice extraction helpers ─────────────────────────────────────────────

/** Extract base identity + header scalars for an NPC theme template page. */
export function extractNpcThemeTemplateBase(common: CommonExtraction): NpcThemeTemplateBaseSlice {
  return {
    url:                   common.url,
    npc_theme_template_id: extractEntityId(common.url),
    name:                  common.title.name,
    rarity:                common.traits.rarity,
    pfs:                   common.title.pfs,
    legacy:                common.title.legacy,
    alt_edition_url:       common.title.alt_edition_url,
    traits:                common.traits.traits,
    trait_ids:             common.traits.trait_ids,
    source:                { book: common.source.book, page: common.source.page, source_id: common.source.source_id },
    sources:               common.sources,
  };
}

/**
 * Extract flavor blurb + All Creatures baseline mods + level-tier benefits
 * from the page body. The body is a flat sequence of `<b>Label</b> Value`
 * pairs separated by `<br/>`; there are no `<h2>` sections.
 */
export function extractNpcThemeTemplateTraitsMods(common: CommonExtraction): NpcThemeTemplateTraitsModsSlice {
  const html = common.body_html;
  // Flavor = text BEFORE the first `<b>` boundary in body_html.
  let flavor: string | null = null;
  const firstBold = /<b>/i.exec(html);
  if (firstBold !== null) {
    const head = html.slice(0, firstBold.index);
    const headText = htmlToText(head);
    if (headText !== '') flavor = headText;
  } else {
    const headText = htmlToText(html);
    if (headText !== '') flavor = headText;
  }

  let all_creatures: { text: string; text_html: string } | null = null;
  const tiers: NpcThemeTemplateTier[] = [];

  for (const { label, valueHtml } of harvestOrderedBoldPairs(html)) {
    if (label.toLowerCase() === 'all creatures') {
      all_creatures = {
        text:      cleanValueText(valueHtml),
        text_html: cleanValueHtml(valueHtml),
      };
      continue;
    }
    const tierMatch = TIER_LABEL_RE.exec(label);
    if (tierMatch !== null) {
      const level = parseInt(tierMatch[1]!, 10);
      if (!Number.isFinite(level)) continue;
      tiers.push({
        level,
        label,
        text:      cleanValueText(valueHtml),
        text_html: cleanValueHtml(valueHtml),
      });
    }
  }

  return { flavor, all_creatures, tiers };
}

/** Extract meta slice marker — sections/links/body/meta attach in finalize. */
export function extractNpcThemeTemplateMeta(_common: CommonExtraction): NpcThemeTemplateMetaSlice {
  return { __npc_theme_template_meta_marked: true };
}

// ─── Finalize ────────────────────────────────────────────────────────────────

const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = ['Source'];

export function finalizeNpcThemeTemplate(
  common:      CommonExtraction,
  base:        NpcThemeTemplateBaseSlice,
  traitsMods:  NpcThemeTemplateTraitsModsSlice,
  _meta:       NpcThemeTemplateMetaSlice,
  root:        CheerioAPI,
  _target:     CheerioNode,
): NpcThemeTemplateOutput {
  void _meta;
  void _target;
  const raw_fields = stripStructuredKeys(common.field_map, CLAIMED_FIELD_LABELS);
  return {
    ...base,
    ...traitsMods,
    sections:         common.sections,
    raw_fields,
    links:            common.links,
    body_text:        common.body_text,
    body_html:        common.body_html,
    meta_description: extractMetaDescription(root),
    meta_keywords:    extractMetaKeywords(root),
  } satisfies NpcThemeTemplateOutput;
}

/**
 * Project an NPCThemeTemplates.aspx page into a typed NpcThemeTemplateOutput.
 *
 * Thin assembly wrapper kept for `parseAonHtml` direct-call paths and unit
 * tests. The DAG pipeline calls the per-slice helpers individually through
 * the decomposed NPC-theme-template extraction nodes.
 */
export function extractNpcThemeTemplate(
  common: CommonExtraction,
  root:   CheerioAPI,
  target: CheerioNode,
): NpcThemeTemplateOutput {
  const base       = extractNpcThemeTemplateBase(common);
  const traitsMods = extractNpcThemeTemplateTraitsMods(common);
  const meta       = extractNpcThemeTemplateMeta(common);
  return finalizeNpcThemeTemplate(common, base, traitsMods, meta, root, target);
}

// Re-export output type so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

// Node: extract:npc-theme-template-base
// Identity + sources slice.

export type NpcThemeTemplateBaseOutput = 'success' | 'error';

class NpcThemeTemplateBaseNodeImpl extends ScalarNode<ScrapeState, NpcThemeTemplateBaseOutput> {
  public readonly name    = 'extract:npc-theme-template-base';
  public readonly outputs = CAPABILITY_OUTPUTS;
  public override readonly contract: OperationContractFragmentType = {
    hardRequired: ['aonprdCommon'],
    produces:     [],
  };

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<NpcThemeTemplateBaseOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const base = extractNpcThemeTemplateBase(common);

    state.output = { ...state.output, ...base };

    return NodeOutputBuilder.of('success');
  }
}
export const npcThemeTemplateBaseNode = new NpcThemeTemplateBaseNodeImpl();

// ─────────────────────────────────────────────────────────────────────────────

// Node: extract:npc-theme-template-traits-mods
// Flavor blurb + All Creatures baseline mods + per-tier level benefits.

export type NpcThemeTemplateTraitsModsOutput = 'success' | 'error';

class NpcThemeTemplateTraitsModsNodeImpl extends ScalarNode<ScrapeState, NpcThemeTemplateTraitsModsOutput> {
  public readonly name    = 'extract:npc-theme-template-traits-mods';
  public readonly outputs = CAPABILITY_OUTPUTS;
  public override readonly contract: OperationContractFragmentType = {
    hardRequired: ['aonprdCommon'],
    produces:     [],
  };

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<NpcThemeTemplateTraitsModsOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const slice = extractNpcThemeTemplateTraitsMods(common);

    state.output = { ...state.output, ...slice };

    return NodeOutputBuilder.of('success');
  }
}
export const npcThemeTemplateTraitsModsNode = new NpcThemeTemplateTraitsModsNodeImpl();

// ─────────────────────────────────────────────────────────────────────────────

// Node: finalize:npc-theme-template
// Assembles raw_fields + sections + meta tags.

export type FinalizeNpcThemeTemplateOutput = 'success';

class FinalizeNpcThemeTemplateNodeImpl extends ScalarNode<ScrapeState, FinalizeNpcThemeTemplateOutput> {
  public readonly name    = 'finalize:npc-theme-template';
  public readonly outputs = ['success'] as const;
  public override readonly contract: OperationContractFragmentType = {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'aonprdTarget'],
    produces:     [],
  };

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<FinalizeNpcThemeTemplateOutput>> {
    const common  = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root    = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target  = state.getMetadata<CheerioNode>('aonprdTarget');
    if (common === undefined || root === undefined || target === undefined) return NodeOutputBuilder.of('success');

    const meta       = { __npc_theme_template_meta_marked: true as const };
    const acc = (state.output ?? {}) as unknown as NpcThemeTemplateOutput;
    const assembled = finalizeNpcThemeTemplate(common, acc, acc, meta, root, target);
    setConceptOutput(state, assembled);

    return NodeOutputBuilder.of('success');
  }
}
export const finalizeNpcThemeTemplateNode = new FinalizeNpcThemeTemplateNodeImpl();

// ─── ConceptDecl export ───────────────────────────────────────────────────────

/**
 * NPC-theme-template concept declaration for the AONPRD taxonomy.
 * Imported by `plugins/aonprd/taxonomy/aonprd.ts`.
 */
export const npcThemeTemplateConcept: ConceptDecl<NpcThemeTemplateOutput> = {
  id:       'npc-theme-template',
  parent:   'entity',
  urlPaths: ['npcthemetemplates'],
  capabilities: [
    npcThemeTemplateBaseNode,
    npcThemeTemplateTraitsModsNode,
    finalizeNpcThemeTemplateNode,
  ],
};
