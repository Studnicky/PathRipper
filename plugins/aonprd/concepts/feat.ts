//
// Four decomposed slices: base (identity + meta SEO tags), prerequisites
// (archetype links, class scoping, spoiler notice), effect (activation fields
// + description prose), and meta (Leads To, Related Feats, trait glossary).
//
// Covers both `feats` and `mythicfeats` URL paths — mythic detection is via
// the `level_kind === "Mythic"` check inside extractFeatBase.
//
// re-execution in the taxonomy pipeline; myth-feat disambiguation is
// transparent via the `is_mythic` field rather than a separate type.
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
  type ActionCost,
  type LinkRef,
  type Rarity,
  type PfsLegality,
  type SourceRef,
  getField,
  getFieldHtml,
  htmlToText,
  extractEntityId,
  extractMetaDescription,
  extractMetaKeywords,
  stripStructuredKeys,
} from '../common.js';


// ─── Output shape ─────────────────────────────────────────────────────────────

export interface FeatOutput {
  url: string;
  /** Numeric AON ID extracted from the URL query string. */
  feat_id: number | null;
  name: string;
  level: number | null;
  rarity: Rarity;
  pfs: PfsLegality | null;
  legacy: boolean;
  alt_edition_url: string | null;
  action_cost: ActionCost | null;
  traits: string[];
  /** Trait AON IDs keyed by trait name (e.g. `{ "Dwarf": 52 }`). */
  trait_ids: Record<string, number>;
  source: { book: string | null; page: number | null; source_id: number | null };
  /** All source refs on the page (header + body footnotes). */
  sources: SourceRef[];
  archetypes: Array<{ name: string; archetype_id: number | null }>;
  archetype_footnotes: string[];
  /**
   * Classes associated with this feat via the `<b>Class</b>` field.
   * Present on a small number of archetype feats that are scoped to specific classes.
   */
  class_archetypes: Array<{ name: string; class_id: number | null }>;
  /**
   * Adventure Path or product spoiler notice, from the `<h2 class="title">This Feat
   * may contain spoilers from …</h2>` element. Null when no notice is present.
   */
  spoiler_source: string | null;
  prerequisites: string | null;
  frequency: string | null;
  trigger: string | null;
  requirements: string | null;
  cost: string | null;
  access: string | null;
  /** True when the feat carries a "Mythic" level-kind marker or Mythic trait. */
  is_mythic: boolean;
  description_html: string;
  description_text: string;
  special: string | null;
  leads_to: Array<{ name: string; feat_id: number | null }>;
  /** Related feats listed in the `<b>Related Feats</b>` inline field. */
  related_feats: Array<{ name: string; feat_id: number | null }>;
  trait_glossary: Array<{ trait: string; description: string }>;
  raw_fields: Record<string, string>;
  links: LinkRef[];
  /** `<meta name="description">` content. */
  meta_description: string | null;
  /** `<meta name="keywords">` content. */
  meta_keywords: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DASH_RE = /^(?:—|–|-|&mdash;|&ndash;)$/;

/** Treat em-dash / en-dash / hyphen sentinel values as null. */
function dashToNull(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (DASH_RE.test(trimmed)) return null;
  return trimmed;
}

/** Extract `<b>Special</b>` paragraph text from the body HTML, if present. */
function extractSpecial(bodyHtml: string): string | null {
  const m = /<b>\s*Special\s*<\/b>([\s\S]*?)(?=<b>|<h2|<h3|$)/i.exec(bodyHtml);
  if (m === null) return null;
  const text = htmlToText(m[1] ?? '');
  return text === '' ? null : text;
}

/** Build the prose description, stripping out the `<b>Special</b>` paragraph. */
function buildDescription(bodyHtml: string): { html: string; text: string } {
  const subIdx = /<h2\s+class="title"/i.exec(bodyHtml);
  const before = subIdx === null ? bodyHtml : bodyHtml.slice(0, subIdx.index);
  const stripped = before.replace(/<b>\s*Special\s*<\/b>[\s\S]*?(?=<b>|<h2|<h3|$)/i, '');
  return { html: stripped.trim(), text: htmlToText(stripped) };
}

/** Parse the Archetype/Archetypes field into structured refs. */
function parseArchetypes(valueHtml: string | null): Array<{ name: string; archetype_id: number | null }> {
  if (valueHtml === null) return [];
  const out: Array<{ name: string; archetype_id: number | null }> = [];
  const anchorRe = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(valueHtml)) !== null) {
    const href = m[1] ?? '';
    if (!/Archetypes\.aspx/i.test(href)) continue;
    const idMatch = /\?ID=(\d+)/i.exec(href);
    const archetype_id = idMatch !== null ? parseInt(idMatch[1]!, 10) : null;
    const name = htmlToText(m[2] ?? '');
    if (name === '') continue;
    out.push({ name, archetype_id });
  }
  return out;
}

/** Capture archetype footnote lines (e.g. `* This archetype offers …`). */
function parseArchetypeFootnotes(headHtml: string): string[] {
  const out: string[] = [];
  const segments = headHtml.split(/<br\s*\/?>/i);
  for (const seg of segments) {
    const text = htmlToText(seg);
    if (text.startsWith('*')) {
      const trimmed = text.slice(1).trim();
      if (trimmed !== '') out.push(trimmed);
    }
  }
  return out;
}

/** Find the `<h2 class="title">… Leads To...</h2>` section and harvest its anchor list. */
function parseLeadsTo(c: CommonExtraction): Array<{ name: string; feat_id: number | null }> {
  const out: Array<{ name: string; feat_id: number | null }> = [];
  const section = c.sections.find((s) => /Leads To\.{2,3}\s*$/i.test(s.heading));
  if (section === undefined) return out;
  for (const link of section.links) {
    if (!/Feats\.aspx/i.test(link.href)) continue;
    out.push({ name: link.text, feat_id: link.id });
  }
  return out;
}

/**
 * Parse the inline `<b>Related Feats</b>: …` field.
 * This field may appear in either the head section or the body (after `<hr />`).
 */
function parseRelatedFeats(fullHtml: string): Array<{ name: string; feat_id: number | null }> {
  // Capture from the <b>Related Feats</b> marker up to the next <b> or <br/><br/> gap.
  const m = /<b>\s*Related Feats\s*<\/b>\s*:?\s*([\s\S]*?)(?=<br\s*\/?>[\s\S]{0,4}<br\s*\/?>|<b>|<h[1-6]|$)/i.exec(fullHtml);
  if (m === null) return [];
  const fragment = m[1] ?? '';
  const out: Array<{ name: string; feat_id: number | null }> = [];
  const anchorRe = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let am: RegExpExecArray | null;
  while ((am = anchorRe.exec(fragment)) !== null) {
    const href = am[1] ?? '';
    if (!/Feats\.aspx/i.test(href)) continue;
    const idMatch = /\?ID=(\d+)/i.exec(href);
    const feat_id = idMatch !== null ? parseInt(idMatch[1]!, 10) : null;
    const name = htmlToText(am[2] ?? '');
    if (name === '') continue;
    out.push({ name, feat_id });
  }
  return out;
}

/** Find `<h2 class="title">Traits</h2>` and harvest the `<div class="trait-entry">` glossary. */
function parseTraitGlossary($: CheerioAPI, span: CheerioNode): Array<{ trait: string; description: string }> {
  const out: Array<{ trait: string; description: string }> = [];
  span.find('div.trait-entry').each((_, el) => {
    const html = $(el).html() ?? '';
    const labelMatch = /<b>\s*([^<]+?)\s*<\/b>([\s\S]*)/i.exec(html);
    if (labelMatch === null) return;
    const trait = (labelMatch[1] ?? '').replace(/:$/, '').trim();
    const description = htmlToText(labelMatch[2] ?? '');
    if (trait === '') return;
    out.push({ trait, description });
  });
  return out;
}

/** Slice the head HTML (before the first `<hr />`) out of the content span. */
function readHeadHtml(span: CheerioNode): string {
  const html = span.html() ?? '';
  const m = /<hr\s*\/?>/i.exec(html);
  return m === null ? html : html.slice(0, m.index);
}

/** Parse the `<b>Class</b>` field into structured refs linking to Classes.aspx. */
function parseClassArchetypes(valueHtml: string | null): Array<{ name: string; class_id: number | null }> {
  if (valueHtml === null) return [];
  const out: Array<{ name: string; class_id: number | null }> = [];
  const anchorRe = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(valueHtml)) !== null) {
    const href = m[1] ?? '';
    if (!/Classes\.aspx/i.test(href)) continue;
    const idMatch = /\?ID=(\d+)/i.exec(href);
    const class_id = idMatch !== null ? parseInt(idMatch[1]!, 10) : null;
    const name = htmlToText(m[2] ?? '');
    if (name === '') continue;
    out.push({ name, class_id });
  }
  return out;
}

/**
 * Extract the `<h2 class="title">This Feat may contain spoilers from …</h2>`
 * advisory notice. Returns the full text, or null.
 */
function parseFeatSpoilerSource($: CheerioAPI): string | null {
  const headings = $('h2.title, h3.title').toArray();
  for (const el of headings) {
    const text = $(el).text().trim();
    if (/^This \w+ may contain spoilers/i.test(text)) return text;
  }
  return null;
}

// ─── Per-node slice types ─────────────────────────────────────────────────────

/** Fields owned by `extract-feat-base`. */
export interface FeatBaseSlice {
  url:              string;
  feat_id:          number | null;
  name:             string;
  level:            number | null;
  rarity:           Rarity;
  pfs:              PfsLegality | null;
  legacy:           boolean;
  alt_edition_url:  string | null;
  action_cost:      ActionCost | null;
  traits:           string[];
  trait_ids:        Record<string, number>;
  source:           FeatOutput['source'];
  sources:          SourceRef[];
  is_mythic:        boolean;
  meta_description: string | null;
  meta_keywords:    string | null;
}

/** Fields owned by `extract-feat-prerequisites`. */
export interface FeatPrerequisitesSlice {
  archetypes:           FeatOutput['archetypes'];
  archetype_footnotes:  string[];
  class_archetypes:     FeatOutput['class_archetypes'];
  spoiler_source:       string | null;
  prerequisites:        string | null;
}

/** Fields owned by `extract-feat-effect`. */
export interface FeatEffectSlice {
  frequency:        string | null;
  trigger:          string | null;
  requirements:     string | null;
  cost:             string | null;
  access:           string | null;
  description_html: string;
  description_text: string;
  special:          string | null;
}

/** Fields owned by `extract-feat-meta`. */
export interface FeatMetaSlice {
  leads_to:        FeatOutput['leads_to'];
  related_feats:   FeatOutput['related_feats'];
  trait_glossary:  FeatOutput['trait_glossary'];
  links:           LinkRef[];
}

// ─── Per-slice extraction helpers ─────────────────────────────────────────────

/** Extract identity, header scalars, and `<meta>` SEO fields. */
export function extractFeatBase(c: CommonExtraction, $: CheerioAPI, _span: CheerioNode): FeatBaseSlice {
  // Detect mythic feats: level_kind is "Mythic" or traits include "Mythic".
  const is_mythic =
    (c.title.level_kind ?? '').toLowerCase() === 'mythic' ||
    c.traits.traits.some((t) => t.toLowerCase() === 'mythic');

  return {
    url:              c.url,
    feat_id:          extractEntityId(c.url),
    name:             c.title.name,
    level:            c.title.level,
    rarity:           c.traits.rarity,
    pfs:              c.title.pfs,
    legacy:           c.title.legacy,
    alt_edition_url:  c.title.alt_edition_url,
    action_cost:      c.title.action_cost,
    traits:           c.traits.traits,
    trait_ids:        c.traits.trait_ids,
    source:           { book: c.source.book, page: c.source.page, source_id: c.source.source_id },
    sources:          c.sources,
    is_mythic,
    meta_description: extractMetaDescription($),
    meta_keywords:    extractMetaKeywords($),
  };
}

/** Extract archetype linkage, class scoping, spoiler advisory, and prerequisites. */
export function extractFeatPrerequisites(c: CommonExtraction, $: CheerioAPI, span: CheerioNode): FeatPrerequisitesSlice {
  const archetypeHtml = getFieldHtml(c, 'Archetype', 'Archetypes');
  const archetypes = parseArchetypes(archetypeHtml);
  const headHtml = readHeadHtml(span);
  const archetype_footnotes = parseArchetypeFootnotes(headHtml);
  const class_archetypes = parseClassArchetypes(getFieldHtml(c, 'Class'));
  const spoiler_source = parseFeatSpoilerSource($);

  return {
    archetypes,
    archetype_footnotes,
    class_archetypes,
    spoiler_source,
    prerequisites: dashToNull(getField(c, 'Prerequisites', 'Prerequisite')),
  };
}

/** Extract activation-style fields (Frequency/Trigger/Requirements/Cost/Access) and the prose body. */
export function extractFeatEffect(c: CommonExtraction): FeatEffectSlice {
  const description = buildDescription(c.body_html);
  const special = extractSpecial(c.body_html);

  return {
    frequency:        dashToNull(getField(c, 'Frequency')),
    trigger:          dashToNull(getField(c, 'Trigger')),
    requirements:     dashToNull(getField(c, 'Requirements')),
    cost:             dashToNull(getField(c, 'Cost')),
    access:           dashToNull(getField(c, 'Access')),
    description_html: description.html,
    description_text: description.text,
    special,
  };
}

/** Extract cross-page navigation: Leads To, Related Feats, in-page Traits glossary, body links. */
export function extractFeatMeta(c: CommonExtraction, $: CheerioAPI, span: CheerioNode): FeatMetaSlice {
  const leads_to = parseLeadsTo(c);
  // Related Feats may appear in the head or the body depending on the page.
  const fullHtml = span.html() ?? '';
  const related_feats = parseRelatedFeats(fullHtml);
  const trait_glossary = parseTraitGlossary($, span);
  return {
    leads_to,
    related_feats,
    trait_glossary,
    links: c.links,
  };
}

/** AON labels every per-slice helper has lifted into structured fields. */
const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  // Prerequisites slice
  'Archetype', 'Archetypes', 'Class', 'Prerequisites', 'Prerequisite',
  // Effect slice
  'Frequency', 'Trigger', 'Requirements', 'Cost', 'Access', 'Effect', 'Special',
  // Activate-item feats reuse the equipment Usage label inside the feat body.
  'Usage',
  // Source is harvested separately as structured SourceRef by common.ts, but
  // the harvester already drops it; included for parity with the monster strip.
  'Source',
];

/**
 * Feats with adventure-path flavor prose sometimes inline a bold-tagged NPC
 * name in the description (e.g. `<b>Arba Dwindletree</b> taught you…`). These
 * leak through the field harvester as raw_fields keys with prose-shaped
 * values. They are not structured data — drop them.
 *
 * Heuristic: Title-Case multi-word label OR Title-Case+honorific (`Dr.`,
 * `Sir`) OR contains a hyphen between Title-Case segments. Combined with a
 * loose whitelist check upstream this is safe — every real feat header label
 * is already in {@link CLAIMED_FIELD_LABELS} or is single-word lowercase
 * stat-block-style.
 */
function isFlavorNpcName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length === 0) return false;
  // Multi-word Title-Case (e.g. "Arba Dwindletree", "Queen Galfrey", "Dr. Ashley Arrowbaud").
  if (/^[A-Z][A-Za-z'.\-]*(?:[ '\-][A-Z][A-Za-z'.\-]*)+$/.test(trimmed)) return true;
  // Single-word Title-Case "stage name" (e.g. "Moloch", "Thais", "Jinx").
  if (/^[A-Z][a-z]{2,}$/.test(trimmed)) return true;
  return false;
}

/**
 * Assemble the final FeatOutput from per-slice results.
 *
 * Computes `raw_fields` by stripping every AON label claimed by upstream
 * slices (CLAIMED_FIELD_LABELS). Whatever remains in `raw_fields` is
 * unstructured residue (NPC bold tags in flavor prose, etc.).
 */
export function finalizeFeat(
  c:             CommonExtraction,
  base:          FeatBaseSlice,
  prerequisites: FeatPrerequisitesSlice,
  effect:        FeatEffectSlice,
  meta:          FeatMetaSlice,
): FeatOutput {
  const stripped  = stripStructuredKeys(c.field_map, CLAIMED_FIELD_LABELS);
  const raw_fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(stripped)) {
    if (isFlavorNpcName(k)) continue;
    raw_fields[k] = v;
  }

  return {
    ...base,
    ...prerequisites,
    ...effect,
    ...meta,
    raw_fields,
  } satisfies FeatOutput;
}

// ─── Public extractor ─────────────────────────────────────────────────────────

/**
 * Project a CommonExtraction of a Feats.aspx page into a typed FeatOutput.
 *
 * Thin assembly wrapper kept for `parseAonHtml` direct-call paths and unit
 * tests. The DAG pipeline calls the per-slice helpers individually through
 * the decomposed feat extraction nodes.
 */
export function extractFeat(c: CommonExtraction, $: CheerioAPI, span: CheerioNode): FeatOutput {
  const base          = extractFeatBase(c, $, span);
  const prerequisites = extractFeatPrerequisites(c, $, span);
  const effect        = extractFeatEffect(c);
  const meta          = extractFeatMeta(c, $, span);
  return finalizeFeat(c, base, prerequisites, effect, meta);
}

// Re-export output type so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

// Node: extract:feat-base
// Identity + SEO meta tags slice.

export type FeatBaseOutput = 'success' | 'error';

export const featBaseNode: NodeInterface<ScrapeState, FeatBaseOutput, RipperServices> = {
  name:    'extract:feat-base',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'aonprdTarget'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FeatBaseOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined || target === undefined) return { output: 'error' };

    const base = extractFeatBase(c, $, target);

    state.output = { ...state.output, ...base };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

// Node: extract:feat-prerequisites
// Archetype links, class scoping, spoiler notice, prerequisites.

export type FeatPrerequisitesOutput = 'success' | 'error';

export const featPrerequisitesNode: NodeInterface<ScrapeState, FeatPrerequisitesOutput, RipperServices> = {
  name:    'extract:feat-prerequisites',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'aonprdTarget'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FeatPrerequisitesOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined || target === undefined) return { output: 'error' };

    const slice = extractFeatPrerequisites(c, $, target);

    state.output = { ...state.output, ...slice };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

// Node: extract:feat-effect
// Activation fields (Frequency/Trigger/Requirements/Cost/Access) + description.

export type FeatEffectOutput = 'success' | 'error';

export const featEffectNode: NodeInterface<ScrapeState, FeatEffectOutput, RipperServices> = {
  name:    'extract:feat-effect',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FeatEffectOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const slice = extractFeatEffect(c);

    state.output = { ...state.output, ...slice };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

// Node: extract:feat-meta
// Leads To, Related Feats, in-page trait glossary, body links.

export type FeatMetaOutput = 'success' | 'error';

export const featMetaNode: NodeInterface<ScrapeState, FeatMetaOutput, RipperServices> = {
  name:    'extract:feat-meta',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'aonprdTarget'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FeatMetaOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined || target === undefined) return { output: 'error' };

    const slice = extractFeatMeta(c, $, target);

    state.output = { ...state.output, ...slice };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

// Node: finalize:feat
// Assembles raw_fields stripping claimed labels + NPC-name heuristic filter.

export type FinalizeFeatOutput = 'success';

export const finalizeFeatNode: NodeInterface<ScrapeState, FinalizeFeatOutput, RipperServices> = {
  name:    'finalize:feat',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'aonprdTarget'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FinalizeFeatOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined || target === undefined) return { output: 'success' };
    const acc = (state.output ?? {}) as unknown as FeatOutput;
    const assembled = finalizeFeat(c, acc, acc, acc, acc);
    setConceptOutput(state, assembled);

    return { output: 'success' };
  },
};

// ─── ConceptDecl export ───────────────────────────────────────────────────────

/**
 * Feat concept declaration for the AONPRD taxonomy.
 * Covers both `feats` and `mythicfeats` URL paths.
 * Imported by `plugins/aonprd/taxonomy/aonprd.ts`.
 */
export const featConcept: ConceptDecl<FeatOutput> = {
  id:       'feat',
  parent:   'entity',
  urlPaths: ['feats', 'mythicfeats'],
  capabilities: [
    featBaseNode,
    featPrerequisitesNode,
    featEffectNode,
    featMetaNode,
    finalizeFeatNode,
  ],
};
