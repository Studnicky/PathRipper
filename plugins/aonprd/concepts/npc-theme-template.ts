//
// Two decomposed slices: base (identity + sources) and traits-mods (flavor
// blurb + All Creatures baseline + per-tier level benefits). Finalize
// assembles raw_fields + meta.
//
// is a first-class slice rather than being embedded inside a monolithic
// finalize function.
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

// ─── Inlined from Wave 5: npc-theme-template.ts ──────────────────────────────────
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
  const re = /<b>([\s\S]*?)<\/b>([\s\S]*?)(?=<b>|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const labelHtml = m[1] ?? '';
    const valueHtml = m[2] ?? '';
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
export function extractNpcThemeTemplateBase(c: CommonExtraction): NpcThemeTemplateBaseSlice {
  return {
    url:                   c.url,
    npc_theme_template_id: extractEntityId(c.url),
    name:                  c.title.name,
    rarity:                c.traits.rarity,
    pfs:                   c.title.pfs,
    legacy:                c.title.legacy,
    alt_edition_url:       c.title.alt_edition_url,
    traits:                c.traits.traits,
    trait_ids:             c.traits.trait_ids,
    source:                { book: c.source.book, page: c.source.page, source_id: c.source.source_id },
    sources:               c.sources,
  };
}

/**
 * Extract flavor blurb + All Creatures baseline mods + level-tier benefits
 * from the page body. The body is a flat sequence of `<b>Label</b> Value`
 * pairs separated by `<br/>`; there are no `<h2>` sections.
 */
export function extractNpcThemeTemplateTraitsMods(c: CommonExtraction): NpcThemeTemplateTraitsModsSlice {
  const html = c.body_html;
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
export function extractNpcThemeTemplateMeta(_c: CommonExtraction): NpcThemeTemplateMetaSlice {
  return { __npc_theme_template_meta_marked: true };
}

// ─── Finalize ────────────────────────────────────────────────────────────────

const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = ['Source'];

export function finalizeNpcThemeTemplate(
  c:           CommonExtraction,
  base:        NpcThemeTemplateBaseSlice,
  traitsMods:  NpcThemeTemplateTraitsModsSlice,
  _meta:       NpcThemeTemplateMetaSlice,
  $:           CheerioAPI,
  _target:     CheerioNode,
): NpcThemeTemplateOutput {
  void _meta;
  void _target;
  const raw_fields = stripStructuredKeys(c.field_map, CLAIMED_FIELD_LABELS);
  return {
    ...base,
    ...traitsMods,
    sections:         c.sections,
    raw_fields,
    links:            c.links,
    body_text:        c.body_text,
    body_html:        c.body_html,
    meta_description: extractMetaDescription($),
    meta_keywords:    extractMetaKeywords($),
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
  c:      CommonExtraction,
  $:      CheerioAPI,
  target: CheerioNode,
): NpcThemeTemplateOutput {
  const base       = extractNpcThemeTemplateBase(c);
  const traitsMods = extractNpcThemeTemplateTraitsMods(c);
  const meta       = extractNpcThemeTemplateMeta(c);
  return finalizeNpcThemeTemplate(c, base, traitsMods, meta, $, target);
}

// Re-export output type so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

// Node: extract:npc-theme-template-base
// Identity + sources slice.

export type NpcThemeTemplateBaseOutput = 'success' | 'error';

export const npcThemeTemplateBaseNode: NodeInterface<ScrapeState, NpcThemeTemplateBaseOutput, RipperServices> = {
  name:    'extract:npc-theme-template-base',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: NpcThemeTemplateBaseOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const base = extractNpcThemeTemplateBase(c);

    state.output = { ...state.output, ...base };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

// Node: extract:npc-theme-template-traits-mods
// Flavor blurb + All Creatures baseline mods + per-tier level benefits.

export type NpcThemeTemplateTraitsModsOutput = 'success' | 'error';

export const npcThemeTemplateTraitsModsNode: NodeInterface<ScrapeState, NpcThemeTemplateTraitsModsOutput, RipperServices> = {
  name:    'extract:npc-theme-template-traits-mods',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: NpcThemeTemplateTraitsModsOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const slice = extractNpcThemeTemplateTraitsMods(c);

    state.output = { ...state.output, ...slice };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

// Node: finalize:npc-theme-template
// Assembles raw_fields + sections + meta tags.

export type FinalizeNpcThemeTemplateOutput = 'success';

export const finalizeNpcThemeTemplateNode: NodeInterface<ScrapeState, FinalizeNpcThemeTemplateOutput, RipperServices> = {
  name:    'finalize:npc-theme-template',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'aonprdTarget'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FinalizeNpcThemeTemplateOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined || target === undefined) return { output: 'success' };

    const meta       = { __npc_theme_template_meta_marked: true as const };
    const acc = (state.output ?? {}) as unknown as NpcThemeTemplateOutput;
    const assembled = finalizeNpcThemeTemplate(c, acc, acc, meta, $, target);
    setConceptOutput(state, assembled);

    return { output: 'success' };
  },
};

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
