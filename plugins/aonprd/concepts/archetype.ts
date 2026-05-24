//
// Four decomposed slices: base (identity + sources), introduction (flavor prose
// between Source line and first feat heading + optional Rules.aspx cross-link),
// feats (every h2.title feat section projected into structured ArchetypeFeat
// records), and finalize (raw_fields strip with feat-name + flavor-label
// heuristics + meta).
//
// dedication_feat_id) is individually accessible; the introduction slice
// captures the rules_link cross-reference as a typed field.
import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';
import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';

import type { ScrapeState }    from '../../../src/state/ScrapeState.js';
import type { RipperServices } from '../../../src/services/RipperServices.js';
import type { ConceptDecl } from '../taxonomy.js';
import { setConceptOutput } from './_helpers.js';
import { parseGrantedFeatures } from '../capabilities/grantedFeatures.js';
import {
  CAPABILITY_OUTPUTS,
  type CommonExtraction,
  type CheerioNode,
  type LinkRef,
  type Rarity,
  type PfsLegality,
  type Section,
  type SourceRef,
  type ActionCost,
  htmlToText,
  extractEntityId,
  extractMetaDescription,
  extractMetaKeywords,
  stripStructuredKeys,
} from '../common.js';


// ─── Output type ──────────────────────────────────────────────────────────────

/** One feat entry harvested from a `<h2 class="title">` section on the page. */
export interface ArchetypeFeat {
  /** Display name of the feat, without level marker or action glyph. */
  name:        string;
  /** Numeric Feats.aspx ID parsed from the heading anchor. */
  feat_id:     number | null;
  /** Level integer parsed from the trailing "Feat N" marker. */
  level:       number | null;
  /** Action-cost glyph in the heading (Single Action / Free Action / Reaction). */
  action_cost: ActionCost | null;
  /** Trait pill labels harvested from the feat's `<span class="trait*">` row. */
  traits:      string[];
  /** Verbatim section body HTML (label block + `<hr/>` + body). */
  body_html:   string;
  /** Plain-text projection of `body_html`. */
  body_text:   string;
}

export interface ArchetypeOutput {
  url:              string;
  /** Numeric AON Archetypes.aspx ID extracted from the URL query string. */
  archetype_id:     number | null;
  name:             string;
  rarity:           Rarity;
  pfs:              PfsLegality | null;
  legacy:           boolean;
  alt_edition_url:  string | null;
  traits:           string[];
  trait_ids:        Record<string, number>;
  source:           { book: string | null; page: number | null; source_id: number | null };
  sources:          SourceRef[];

  // ─── Introduction ─────────────────────────────────────────────────────────
  /** Flavor prose between the `<b>Source</b>` line and the first feat heading. */
  introduction:        string;
  /** Verbatim HTML for the introduction paragraph. */
  introduction_html:   string;
  /** Optional `Rules.aspx?ID=N` cross-link embedded in the introduction. */
  rules_link:          { href: string; rule_id: number | null } | null;

  // ─── Feats ────────────────────────────────────────────────────────────────
  /** Every `<h2 class="title">` feat section on the page, in source order. */
  feats:               ArchetypeFeat[];
  /** Feat IDs harvested in source order — convenience index for downstream consumers. */
  feat_ids:            number[];
  /** Numeric Feats.aspx ID of the dedication feat (always the first entry, when present). */
  dedication_feat_id:  number | null;

  // ─── Bookkeeping ──────────────────────────────────────────────────────────
  sections:             Section[];
  raw_fields:           Record<string, string>;
  links:                LinkRef[];
  body_text:            string;
  body_html:            string;
  /** `<meta name="description">` content. */
  meta_description:     string | null;
  /** `<meta name="keywords">` content. */
  meta_keywords:        string | null;
}

// ─── Per-node slice types ─────────────────────────────────────────────────────

/** Fields owned by `extract-archetype-base`. */
export interface ArchetypeBaseSlice {
  url:             string;
  archetype_id:    number | null;
  name:            string;
  rarity:          Rarity;
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;
  traits:          string[];
  trait_ids:       Record<string, number>;
  source:          ArchetypeOutput['source'];
  sources:         SourceRef[];
}

/** Fields owned by `extract-archetype-introduction`. */
export interface ArchetypeIntroductionSlice {
  introduction:      string;
  introduction_html: string;
  rules_link:        { href: string; rule_id: number | null } | null;
}

/** Fields owned by `extract-archetype-feats`. */
export interface ArchetypeFeatsSlice {
  feats:              ArchetypeFeat[];
  feat_ids:           number[];
  dedication_feat_id: number | null;
}

/** Fields owned by `extract-archetype-meta`. */
export interface ArchetypeMetaSlice {
  /** Marker so `state.output` accumulates the slice. */
  __archetype_meta_marked: true;
}

// ─── Per-slice extraction helpers ─────────────────────────────────────────────

/** Extract base identity + header scalars for an archetype page. */
export function extractArchetypeBase(c: CommonExtraction): ArchetypeBaseSlice {
  return {
    url:             c.url,
    archetype_id:    extractEntityId(c.url),
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
 * Walk the content span between `<b>Source</b>` and the first non-decorative
 * `<h2 class="title">` to collect the flavor introduction. Falls back to the
 * shared `body_text` when no feat sections are present.
 */
export function extractArchetypeIntroduction(
  c:    CommonExtraction,
  $:    CheerioAPI,
  span: CheerioNode,
): ArchetypeIntroductionSlice {
  const html = span.html() ?? '';
  // Cut from the closing `</a>` of the `<b>Source</b> … <a>book pg</a>` line
  // up to the first `<h2 class="title">` (not decorative). The source anchor
  // closes with `</a><br />`; the flavor begins after the trailing `<br />`.
  const sourceCutRe = /<b>\s*Source\s*<\/b>[\s\S]*?<br\s*\/?>/i;
  const sourceMatch = sourceCutRe.exec(html);
  const tail = sourceMatch !== null ? html.slice(sourceMatch.index + sourceMatch[0].length) : html;
  const headingCut = /<h2\b[^>]*class="[^"]*\btitle\b[^"]*"[^>]*>/i.exec(tail);
  const intro_html = headingCut !== null ? tail.slice(0, headingCut.index) : tail;
  // Strip the closing `</span>` of the outer wrapper if the trailing tail
  // crossed it (defensive — shouldn't happen on a well-formed page).
  const cleaned = intro_html.replace(/<\/span>\s*$/i, '').trim();

  // Optional Rules.aspx cross-link (`Click here for more rules on …`).
  let rules_link: { href: string; rule_id: number | null } | null = null;
  const ruleAnchor = /<a\b[^>]*href="([^"]*Rules\.aspx[^"]*)"/i.exec(cleaned);
  if (ruleAnchor !== null) {
    const href = ruleAnchor[1] ?? '';
    const idMatch = /[?&]ID=(\d+)/i.exec(href);
    const rule_id = idMatch !== null ? parseInt(idMatch[1]!, 10) : null;
    rules_link = { href, rule_id: Number.isFinite(rule_id) ? rule_id : null };
  }

  void $;
  return {
    introduction:      htmlToText(cleaned),
    introduction_html: cleaned,
    rules_link,
  };
}

// ─── Feat section parsing ─────────────────────────────────────────────────────

const ACTION_LABEL_TO_COST_MAP: ReadonlyMap<string, ActionCost> = new Map<string, ActionCost>([
  ['one-action',     'one-action'],
  ['single-action',  'one-action'],
  ['two-actions',    'two-actions'],
  ['three-actions',  'three-actions'],
  ['reaction',       'reaction'],
  ['free-action',    'free-action'],
]);

/**
 * Project a single `<h2 class="title">` feat heading + matching Section body
 * into a typed ArchetypeFeat. The heading is walked directly via cheerio so
 * the feat's own `<a href="Feats.aspx?ID=N">` anchor and action glyph survive
 * — `Section.heading` is plain text and discards both.
 */
function parseFeatSection(
  $:       CheerioAPI,
  heading: CheerioNode,
  section: Section,
): ArchetypeFeat | null {
  const headingClone = heading.clone();

  // Right-floated "Feat N" marker.
  let level: number | null = null;
  const trailing = headingClone.find('span[style*="margin-left:auto"]').first();
  const trailingText = trailing.text().trim();
  if (trailingText !== '') {
    const m = /Feat\s+(-?\d+)/i.exec(trailingText);
    if (m !== null) level = parseInt(m[1]!, 10);
  }
  trailing.remove();

  // Action-cost glyph (`<span class="action">[free-action]</span>`).
  let action_cost: ActionCost | null = null;
  const actionSpan = headingClone.find('span.action').first();
  if (actionSpan.length > 0) {
    const glyph = /\[([a-z-]+)\]/i.exec(actionSpan.text());
    if (glyph !== null) {
      action_cost = ACTION_LABEL_TO_COST_MAP.get(glyph[1]!.toLowerCase()) ?? null;
    }
    actionSpan.remove();
  }

  // Strip PFS badge wrappers and the linked PFS anchor.
  headingClone.find('span[style*="float:left"]').remove();
  headingClone.find('a[href*="PFS.aspx"]').remove();

  // Feat ID + display name from the remaining `<a href="Feats.aspx?…">`.
  let feat_id: number | null = null;
  let name = headingClone.text().replace(/\s+/g, ' ').trim();
  const featAnchor = headingClone.find('a[href*="Feats.aspx"]').first();
  if (featAnchor.length > 0) {
    const href = featAnchor.attr('href') ?? '';
    const idMatch = /[?&]ID=(\d+)/i.exec(href);
    if (idMatch !== null) {
      const id = parseInt(idMatch[1]!, 10);
      if (Number.isFinite(id)) feat_id = id;
    }
    const anchorText = featAnchor.text().replace(/\s+/g, ' ').trim();
    if (anchorText !== '') name = anchorText;
  }
  if (name === '') return null;

  // Trait pills at the very top of body_html before `<b>Source</b>`.
  const traitsCut = /<b>\s*Source\s*<\/b>/i.exec(section.body_html);
  const traitsFragment = traitsCut !== null
    ? section.body_html.slice(0, traitsCut.index)
    : section.body_html;
  const traits: string[] = [];
  const traitRe = /<span\s+class="trait(?:uncommon|rare|unique)?"[^>]*>([\s\S]*?)<\/span>/gi;
  let tm: RegExpExecArray | null;
  while ((tm = traitRe.exec(traitsFragment)) !== null) {
    const t = htmlToText(tm[1] ?? '');
    if (t !== '' && !traits.includes(t)) traits.push(t);
  }

  void $;
  return {
    name,
    feat_id,
    level,
    action_cost,
    traits,
    body_html: section.body_html,
    body_text: section.body_text,
  };
}

/** True for `<h2 class="title">` headings that aren't decorative variants. */
function isFeatHeading(el: Element): boolean {
  if (el.tagName.toLowerCase() !== 'h2') return false;
  const cls = (el.attribs?.['class'] ?? '').toLowerCase();
  if (!cls.includes('title')) return false;
  return !cls.includes('feel-title')
      && !cls.includes('hide-on-print')
      && !cls.includes('legacy-content-warning');
}

/**
 * Extract every feat heading on the page in source order. Walks the cheerio
 * span to capture each `<h2 class="title">`'s anchor + action glyph (lost by
 * the shared section harvester) and pairs them with `c.sections` for body
 * fragments.
 */
export function extractArchetypeFeats(
  c:    CommonExtraction,
  $:    CheerioAPI,
  span: CheerioNode,
): ArchetypeFeatsSlice {
  const feats:  ArchetypeFeat[] = [];
  let sectionIdx = 0;
  const sectionList = c.sections.filter((s) => s.level === 2);
  span.find('h2.title').each((_, el) => {
    if (!isFeatHeading(el as Element)) return;
    const section = sectionList[sectionIdx];
    if (section === undefined) return;
    sectionIdx++;
    const feat = parseFeatSection($, $(el), section);
    if (feat === null) return;
    feats.push(feat);
  });
  const feat_ids = feats
    .map((f) => f.feat_id)
    .filter((id): id is number => id !== null);
  const dedication_feat_id = feats[0]?.feat_id ?? null;
  return { feats, feat_ids, dedication_feat_id };
}

/** Extract meta slice marker — sections/links/body/meta attach in finalize. */
export function extractArchetypeMeta(_c: CommonExtraction): ArchetypeMetaSlice {
  return { __archetype_meta_marked: true };
}

// ─── Finalize ────────────────────────────────────────────────────────────────

/**
 * AON labels claimed by upstream archetype slices. Archetype pages rarely
 * populate `field_map` (no `<hr/>` between Source and the first feat section
 * unless the page has a header field block), but Source / Prerequisites can
 * leak through on pre-Remaster pages — strip them so `raw_fields` contains
 * only residue.
 */
const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Source', 'Archetype', 'Prerequisites', 'Frequency', 'Trigger',
  'Requirements', 'Cost', 'Access', 'Special',
  // Class anchor pointing at the parent class page (lifted into class_archetypes).
  'Class', 'Edicts', 'Anathema',
  // Elementalist multi-class table headers + element subsection labels (Air,
  // Earth, Fire, Metal, Water, Wood) on dedicated elementalism archetypes.
  'Archetypes', 'Secrets of Magic Elementalist',
  'Elementalist Adjustments', 'Druid Elementalist Adjustments',
  'Elemental Sorcerer Adjustments', 'Wizard Elementalist Adjustments',
  'Air', 'Earth', 'Fire', 'Metal', 'Water', 'Wood',
  'Elemental Cycle', 'Inner Sea Elementalism',
  // Author / editor note label on some archetype intros.
  'Note',
  // Wellspring multiclass-archetype adjustment table headers.
  'Wellspring Mage Adjustments',
  // Outcomes labels on rare archetype intro-card boxes.
  'Critical Success', 'Success', 'Failure', 'Critical Failure',
  // Inline ability/action labels embedded in archetype intro flavor.
  'Effect', 'Energy Unleashed',
];

/** Title-Case multi-word labels are inline ability-card / NPC-name leaks. */
function isFlavorBoldLabel(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length === 0) return false;
  // Pure-numeric residue first (single-digit `9`, multi-digit `12`) before
  // the length-3 floor on alphabetic names.
  if (/^\d+$/.test(trimmed)) return true;
  if (trimmed.length < 3) return false;
  const core = trimmed.replace(/\s*\([^)]*\)\s*$/, '').trim();
  if (core.length < 3) return false;
  // Multi-word Title-Case (allows lowercase connectors).
  if (/^[A-Z][A-Za-z'.\-]*(?:[ '\-](?:[a-z]{1,4}|[A-Z][A-Za-z'.\-]*))+$/.test(core)) return true;
  // Single-word Title-Case proper name (3+ chars).
  if (/^[A-Z][a-z]{2,}$/.test(core)) return true;
  // Lowercase emphasis word inside flavor prose.
  if (/^[a-z]{4,}$/.test(core)) return true;
  // Adventure-product ID code ("SC- 04910").
  if (/^[A-Z]{1,4}[-\s]\s*\d+$/.test(core)) return true;
  // Pure-numeric residue (e.g. page reference "9").
  if (/^\d+$/.test(core)) return true;
  return false;
}

export function finalizeArchetype(
  c:        CommonExtraction,
  base:     ArchetypeBaseSlice,
  intro:    ArchetypeIntroductionSlice,
  feats:    ArchetypeFeatsSlice,
  _meta:    ArchetypeMetaSlice,
  $:        CheerioAPI,
  _target:  CheerioNode,
): ArchetypeOutput {
  void _meta;
  void _target;
  const stripped  = stripStructuredKeys(c.field_map, CLAIMED_FIELD_LABELS);
  const featNames = new Set(feats.feats.map((f) => f.name.toLowerCase()));
  const raw_fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(stripped)) {
    if (featNames.has(k.toLowerCase())) continue;
    if (isFlavorBoldLabel(k)) continue;
    raw_fields[k] = v;
  }
  return {
    ...base,
    ...intro,
    ...feats,
    sections:         c.sections,
    raw_fields,
    links:            c.links,
    body_text:        c.body_text,
    body_html:        c.body_html,
    meta_description: extractMetaDescription($),
    meta_keywords:    extractMetaKeywords($),
  } satisfies ArchetypeOutput;
}

/**
 * Project an Archetypes.aspx page into a typed ArchetypeOutput.
 *
 * Thin assembly wrapper kept for `parseAonHtml` direct-call paths and unit
 * tests. The DAG pipeline calls the per-slice helpers individually through
 * the decomposed archetype extraction nodes.
 */
export function extractArchetype(
  c:      CommonExtraction,
  $:      CheerioAPI,
  target: CheerioNode,
): ArchetypeOutput {
  const base  = extractArchetypeBase(c);
  const intro = extractArchetypeIntroduction(c, $, target);
  const feats = extractArchetypeFeats(c, $, target);
  const meta  = extractArchetypeMeta(c);
  return finalizeArchetype(c, base, intro, feats, meta, $, target);
}

// Re-export output types so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

// Node: extract:archetype-base
// Identity + sources slice.

export type ArchetypeBaseOutput = 'success' | 'error';

export const archetypeBaseNode: NodeInterface<ScrapeState, ArchetypeBaseOutput, RipperServices> = {
  name:    'extract:archetype-base',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: ArchetypeBaseOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const base = extractArchetypeBase(c);

    state.output = { ...state.output, ...base };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

// Node: extract:archetype-introduction
// Flavor prose + optional Rules.aspx cross-link.

export type ArchetypeIntroductionOutput = 'success' | 'error';

export const archetypeIntroductionNode: NodeInterface<ScrapeState, ArchetypeIntroductionOutput, RipperServices> = {
  name:    'extract:archetype-introduction',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'aonprdTarget'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: ArchetypeIntroductionOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined || target === undefined) return { output: 'error' };

    const slice = extractArchetypeIntroduction(c, $, target);

    state.output = { ...state.output, ...slice };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

// Node: extract:archetype-feats
// Every h2.title feat section → structured ArchetypeFeat records.

export type ArchetypeFeatsOutput = 'success' | 'error';

export const archetypeFeatsNode: NodeInterface<ScrapeState, ArchetypeFeatsOutput, RipperServices> = {
  name:    'extract:archetype-feats',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'aonprdTarget'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: ArchetypeFeatsOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined || target === undefined) return { output: 'error' };

    const slice = extractArchetypeFeats(c, $, target);

    state.output = { ...state.output, ...slice };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

// Node: finalize:archetype
// Assembles raw_fields with feat-name + flavor-label heuristic filter + meta.

export type FinalizeArchetypeOutput = 'success';

export const finalizeArchetypeNode: NodeInterface<ScrapeState, FinalizeArchetypeOutput, RipperServices> = {
  name:    'finalize:archetype',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'aonprdTarget'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FinalizeArchetypeOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined || target === undefined) return { output: 'success' };

    const meta  = { __archetype_meta_marked: true as const };
    const acc = (state.output ?? {}) as unknown as ArchetypeOutput;
    const assembled = finalizeArchetype(c, acc, acc, acc, meta, $, target);
    setConceptOutput(state, assembled);

    return { output: 'success' };
  },
};

// ─── ConceptDecl export ───────────────────────────────────────────────────────

/**
 * Archetype concept declaration for the AONPRD taxonomy.
 * Imported by `plugins/aonprd/taxonomy/aonprd.ts`.
 */
export const archetypeConcept: ConceptDecl<ArchetypeOutput> = {
  id:       'archetype',
  parent:   'entity',
  urlPaths: ['archetypes'],
  capabilities: [
    archetypeBaseNode,
    archetypeIntroductionNode,
    archetypeFeatsNode,
    finalizeArchetypeNode,
  ],
};
