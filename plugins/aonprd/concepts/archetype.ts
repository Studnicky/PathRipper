//
// Four decomposed slices: base (identity + sources), introduction (flavor prose
// between Source line and first feat heading + optional Rules.aspx cross-link),
// feats (every h2.title feat section projected into structured ArchetypeFeat
// records), and finalize (raw_fields strip with feat-name + flavor-label
// heuristics + meta).
//
// dedication_feat_id) is individually accessible; the introduction slice
// captures the rules_link cross-reference as a typed field.
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';
import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';

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
export function extractArchetypeBase(common: CommonExtraction): ArchetypeBaseSlice {
  return {
    url:             common.url,
    archetype_id:    extractEntityId(common.url),
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
 * Walk the content span between `<b>Source</b>` and the first non-decorative
 * `<h2 class="title">` to collect the flavor introduction. Falls back to the
 * shared `body_text` when no feat sections are present.
 */
export function extractArchetypeIntroduction(
  common: CommonExtraction,
  root:   CheerioAPI,
  span:   CheerioNode,
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

  void root;
  void common;
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
  root:    CheerioAPI,
  heading: CheerioNode,
  section: Section,
): ArchetypeFeat | null {
  const headingClone = heading.clone();

  // Right-floated "Feat N" marker.
  let level: number | null = null;
  const trailing = headingClone.find('span[style*="margin-left:auto"]').first();
  const trailingText = trailing.text().trim();
  if (trailingText !== '') {
    const match = /Feat\s+(-?\d+)/i.exec(trailingText);
    if (match !== null) level = parseInt(match[1]!, 10);
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
      const featId = parseInt(idMatch[1]!, 10);
      if (Number.isFinite(featId)) feat_id = featId;
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
  let traitMatch: RegExpExecArray | null;
  while ((traitMatch = traitRe.exec(traitsFragment)) !== null) {
    const traitText = htmlToText(traitMatch[1] ?? '');
    if (traitText !== '' && !traits.includes(traitText)) traits.push(traitText);
  }

  void root;
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
function isFeatHeading(element: Element): boolean {
  if (element.tagName.toLowerCase() !== 'h2') return false;
  const cls = (element.attribs?.['class'] ?? '').toLowerCase();
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
  common: CommonExtraction,
  root:   CheerioAPI,
  span:   CheerioNode,
): ArchetypeFeatsSlice {
  const feats:  ArchetypeFeat[] = [];
  let sectionIdx = 0;
  const sectionList = common.sections.filter((sec) => sec.level === 2);
  span.find('h2.title').each((_index, element) => {
    if (!isFeatHeading(element as Element)) return;
    const section = sectionList[sectionIdx];
    if (section === undefined) return;
    sectionIdx++;
    const feat = parseFeatSection(root, root(element), section);
    if (feat === null) return;
    feats.push(feat);
  });
  const feat_ids = feats
    .map((feat) => feat.feat_id)
    .filter((featId): featId is number => featId !== null);
  const dedication_feat_id = feats[0]?.feat_id ?? null;
  return { feats, feat_ids, dedication_feat_id };
}

/** Extract meta slice marker — sections/links/body/meta attach in finalize. */
export function extractArchetypeMeta(_common: CommonExtraction): ArchetypeMetaSlice {
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
  if (/^[A-Z][A-Za-z'.-]*(?:[ '-](?:[a-z]{1,4}|[A-Z][A-Za-z'.-]*))+$/.test(core)) return true;
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
  common:   CommonExtraction,
  base:     ArchetypeBaseSlice,
  intro:    ArchetypeIntroductionSlice,
  feats:    ArchetypeFeatsSlice,
  _meta:    ArchetypeMetaSlice,
  root:     CheerioAPI,
  _target:  CheerioNode,
): ArchetypeOutput {
  void _meta;
  void _target;
  const stripped  = stripStructuredKeys(common.field_map, CLAIMED_FIELD_LABELS);
  const featNames = new Set(feats.feats.map((feat) => feat.name.toLowerCase()));
  const raw_fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(stripped)) {
    if (featNames.has(key.toLowerCase())) continue;
    if (isFlavorBoldLabel(key)) continue;
    raw_fields[key] = value;
  }
  return {
    ...base,
    ...intro,
    ...feats,
    sections:         common.sections,
    raw_fields,
    links:            common.links,
    body_text:        common.body_text,
    body_html:        common.body_html,
    meta_description: extractMetaDescription(root),
    meta_keywords:    extractMetaKeywords(root),
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
  common: CommonExtraction,
  root:   CheerioAPI,
  target: CheerioNode,
): ArchetypeOutput {
  const base  = extractArchetypeBase(common);
  const intro = extractArchetypeIntroduction(common, root, target);
  const feats = extractArchetypeFeats(common, root, target);
  const meta  = extractArchetypeMeta(common);
  return finalizeArchetype(common, base, intro, feats, meta, root, target);
}

// Re-export output types so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

// Node: extract:archetype-base
// Identity + sources slice.

export type ArchetypeBaseOutput = 'success' | 'error';

class ArchetypeBaseNode extends ScalarNode<ScrapeState, ArchetypeBaseOutput> {
  public readonly name    = 'extract:archetype-base';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<ArchetypeBaseOutput, SchemaObjectType> {
    return {
      success: {
        type: 'object',
        properties: {
          output: {
            type: 'object',
            properties: {
              url:             { type: 'string' },
              archetype_id:    { type: ['integer', 'null'] },
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
  ): Promise<NodeOutputType<ArchetypeBaseOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const base = extractArchetypeBase(common);

    state.output = { ...state.output, ...base };

    return NodeOutputBuilder.of('success');
  }
}

export const archetypeBaseNode = new ArchetypeBaseNode();

// ─────────────────────────────────────────────────────────────────────────────

// Node: extract:archetype-introduction
// Flavor prose + optional Rules.aspx cross-link.

export type ArchetypeIntroductionOutput = 'success' | 'error';

class ArchetypeIntroductionNode extends ScalarNode<ScrapeState, ArchetypeIntroductionOutput> {
  public readonly name    = 'extract:archetype-introduction';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<ArchetypeIntroductionOutput, SchemaObjectType> {
    return {
      success: {
        type: 'object',
        properties: {
          output: {
            type: 'object',
            properties: {
              introduction:      { type: 'string' },
              introduction_html: { type: 'string' },
              rules_link:        { type: ['object', 'null'] },
            },
            required: ['introduction', 'introduction_html'],
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
  ): Promise<NodeOutputType<ArchetypeIntroductionOutput>> {
    const common  = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root    = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target  = state.getMetadata<CheerioNode>('aonprdTarget');
    if (common === undefined || root === undefined || target === undefined) return NodeOutputBuilder.of('error');

    const slice = extractArchetypeIntroduction(common, root, target);

    state.output = { ...state.output, ...slice };

    return NodeOutputBuilder.of('success');
  }
}

export const archetypeIntroductionNode = new ArchetypeIntroductionNode();

// ─────────────────────────────────────────────────────────────────────────────

// Node: extract:archetype-feats
// Every h2.title feat section → structured ArchetypeFeat records.

export type ArchetypeFeatsOutput = 'success' | 'error';

class ArchetypeFeatsNode extends ScalarNode<ScrapeState, ArchetypeFeatsOutput> {
  public readonly name    = 'extract:archetype-feats';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<ArchetypeFeatsOutput, SchemaObjectType> {
    return {
      success: {
        type: 'object',
        properties: {
          output: {
            type: 'object',
            properties: {
              feats:              { type: 'array', items: { type: 'object' } },
              feat_ids:           { type: 'array', items: { type: 'integer' } },
              dedication_feat_id: { type: ['integer', 'null'] },
            },
            required: ['feats', 'feat_ids'],
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
  ): Promise<NodeOutputType<ArchetypeFeatsOutput>> {
    const common  = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root    = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target  = state.getMetadata<CheerioNode>('aonprdTarget');
    if (common === undefined || root === undefined || target === undefined) return NodeOutputBuilder.of('error');

    const slice = extractArchetypeFeats(common, root, target);

    state.output = { ...state.output, ...slice };

    return NodeOutputBuilder.of('success');
  }
}

export const archetypeFeatsNode = new ArchetypeFeatsNode();

// ─────────────────────────────────────────────────────────────────────────────

// Node: finalize:archetype
// Assembles raw_fields with feat-name + flavor-label heuristic filter + meta.

export type FinalizeArchetypeOutput = 'success';

class FinalizeArchetypeNode extends ScalarNode<ScrapeState, FinalizeArchetypeOutput> {
  public readonly name    = 'finalize:archetype';
  public readonly outputs = ['success'] as const;

  public override get outputSchema(): Record<FinalizeArchetypeOutput, SchemaObjectType> {
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
  ): Promise<NodeOutputType<FinalizeArchetypeOutput>> {
    const common  = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root    = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target  = state.getMetadata<CheerioNode>('aonprdTarget');
    if (common === undefined || root === undefined || target === undefined) return NodeOutputBuilder.of('success');

    const meta  = { __archetype_meta_marked: true as const };
    const acc = (state.output ?? {}) as unknown as ArchetypeOutput;
    const assembled = finalizeArchetype(common, acc, acc, acc, meta, root, target);
    setConceptOutput(state, assembled);

    return NodeOutputBuilder.of('success');
  }
}

export const finalizeArchetypeNode = new FinalizeArchetypeNode();

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
