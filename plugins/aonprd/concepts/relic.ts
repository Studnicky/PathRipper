//
// Covers both single-gift pages (?ID=N) and aspect-aggregator pages
// (?Aspect=N) under one concept.
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
  getField,
  htmlToText,
  extractEntityId,
  extractMetaDescription,
  extractMetaKeywords,
  stripStructuredKeys,
} from '../common.js';

// ─── Output type ─────────────────────────────────────────────────────────────

/** A single relic gift (Minor/Major/Grand) — either the primary `gift` or one
 *  entry inside an `aspects[]` aggregator page. */
export interface RelicGift {
  /** Gift display name. */
  name:        string;
  /** Gift tier as displayed (`Minor Gift`, `Major Gift`, `Grand Gift`). */
  tier:        string | null;
  /** Aspect label (`air`, `emotion`, `celestial`, …) from `<b>Aspect</b>`. */
  aspect:      string | null;
  /** Trait pill labels for this gift (deduplicated, source order). */
  traits:      string[];
  /** Verbatim prerequisite text from `<b>Prerequisite</b>`, when present. */
  prereqs:     string | null;
  /** Verbatim activate text (action cost glyph kept inline) when present. */
  activate:    string | null;
  /** Verbatim frequency text from `<b>Frequency</b>`, when present. */
  frequency:   string | null;
  /** Free-form effect prose (everything after the `<hr />` boundary). */
  effect:      string;
}

/** A gift entry inside an aggregator `Aspect=N` listing page. */
export interface RelicAspectGift {
  /** Gift display name. */
  name:        string;
  /** Gift tier (`Minor Gift`, `Major Gift`, `Grand Gift`). */
  tier:        string | null;
  /** Per-gift body text after the inline `<hr />`. */
  body:        string;
}

/** Tier milestone reserved for future expansion (AON does not emit these). */
export interface RelicMilestone {
  level:   number | null;
  ability: string;
}

export interface RelicOutput {
  url:              string;
  /** Numeric AON Relics.aspx ID (?ID=N) — null for aspect aggregator pages. */
  relic_id:         number | null;
  /** Numeric aspect-aggregator id (?Aspect=N) — null for single-gift pages. */
  aspect_id:        number | null;
  name:             string;
  rarity:           Rarity;
  pfs:              PfsLegality | null;
  legacy:           boolean;
  alt_edition_url:  string | null;
  traits:           string[];
  trait_ids:        Record<string, number>;
  source:           { book: string | null; page: number | null; source_id: number | null };
  sources:          SourceRef[];

  /** Single-gift projection (populated on `?ID=N` pages, null on aggregators). */
  gift:             RelicGift | null;
  /** Aggregator projection (populated on `?Aspect=N` pages, [] on ID pages). */
  aspects:          RelicAspectGift[];
  /** Tier milestones — reserved slot, AON does not currently render these. */
  milestones:       RelicMilestone[];

  sections:         Section[];
  raw_fields:       Record<string, string>;
  links:            LinkRef[];
  body_text:        string;
  body_html:        string;
  meta_description: string | null;
  meta_keywords:    string | null;
}

// ─── Per-node slice types ─────────────────────────────────────────────────────

export interface RelicBaseSlice {
  url:             string;
  relic_id:        number | null;
  aspect_id:       number | null;
  name:            string;
  rarity:          Rarity;
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;
  traits:          string[];
  trait_ids:       Record<string, number>;
  source:          RelicOutput['source'];
  sources:         SourceRef[];
}

export interface RelicGiftSlice {
  gift: RelicGift | null;
}

export interface RelicAspectsSlice {
  aspects: RelicAspectGift[];
}

export interface RelicMilestonesSlice {
  milestones: RelicMilestone[];
}

export interface RelicMetaSlice {
  __relic_meta_marked: true;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DASH_RE = /^(?:—|–|-|&mdash;|&ndash;)$/;

function dashToNull(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed === '' || DASH_RE.test(trimmed)) return null;
  return trimmed;
}

/**
 * Extract the `?Aspect=N` query parameter from a URL. Distinct from
 * `extractEntityId` (which targets `?ID=N`).
 */
function extractAspectId(url: string): number | null {
  const match = /[?&]Aspect=(\d+)/i.exec(url);
  if (match === null) return null;
  const num = parseInt(match[1]!, 10);
  return Number.isFinite(num) ? num : null;
}

/** Read the right-floated tier marker from the title (`Minor Gift`, `Major Gift`, `Grand Gift`). */
function readTier(common: CommonExtraction): string | null {
  return common.title.level_label;
}

/**
 * Pull the verbatim `<b>Label</b> value` text from the head fragment without
 * needing the value to live in `field_map`. AON sometimes splits Aspect /
 * Prerequisite across a `;` so harvestFields() captures them as expected, but
 * we add this as a defensive fallback.
 */
function readHeadField(headHtml: string, label: string): string | null {
  const regex = new RegExp(`<b>\\s*${label}\\s*</b>([\\s\\S]*?)(?=<b>|<br|<hr|$)`, 'i');
  const match = regex.exec(headHtml);
  if (match === null) return null;
  const text = htmlToText(match[1] ?? '').replace(/[;,]\s*$/, '').trim();
  return text === '' ? null : text;
}

/**
 * Parse the gift-tier marker out of a subsection heading like
 * `Deadly Spark Minor Gift`. AON renders each aggregator gift as a `<h2>` whose
 * inner text concatenates the link name and the right-floated tier span.
 */
function splitAspectGiftHeading(heading: string): { name: string; tier: string | null } {
  const match = /^(.*?)\s+(Minor|Major|Grand|Greater|Lesser)\s+Gift$/i.exec(heading.trim());
  if (match === null) {
    return { name: heading.trim(), tier: null };
  }
  return { name: (match[1] ?? '').trim(), tier: `${match[2]} Gift` };
}

// ─── Per-slice extraction helpers ─────────────────────────────────────────────

/** Extract base identity + header scalars for a relic page. */
export function extractRelicBase(common: CommonExtraction): RelicBaseSlice {
  return {
    url:             common.url,
    relic_id:        extractEntityId(common.url),
    aspect_id:       extractAspectId(common.url),
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
 * Extract the single-gift projection from a `?ID=N` page. Returns `null` when
 * the page is an aspect aggregator (no Aspect/Prerequisite field map, body
 * dominated by `<h2>` subsections).
 *
 * AON renders gift bodies as a single body fragment after the header `<hr />`,
 * with inline `<b>Activate</b>`/`<b>Frequency</b>`/`<b>Effect</b>` labels that
 * do not appear in the harvested header `field_map`. We lift them from the
 * body HTML directly so structured fields populate consistently.
 */
export function extractRelicGift(common: CommonExtraction): RelicGiftSlice {
  // Aggregator pages have multiple sub-gift `<h2 class="title">` blocks and
  // either no aspect field on the header or a `<h1>Relics</h1>` placeholder.
  const isAggregator = common.sections.length > 1 && /Gift$/i.test(common.sections[0]?.heading ?? '');
  if (isAggregator) return { gift: null };

  const aspect    = dashToNull(getField(common, 'Aspect'));
  const prereqs   = dashToNull(getField(common, 'Prerequisite'));
  const activate  = dashToNull(getField(common, 'Activate'))   ?? readHeadField(common.body_html, 'Activate');
  const frequency = dashToNull(getField(common, 'Frequency'))  ?? readHeadField(common.body_html, 'Frequency');
  const tier      = readTier(common);
  const effectRaw = dashToNull(getField(common, 'Effect'))     ?? readHeadField(common.body_html, 'Effect');
  // When the body has no labeled `Effect` block (gift body is pure prose) the
  // entire body_text is the effect; otherwise prefer the labeled portion.
  const effect    = effectRaw ?? common.body_text.trim();

  // If neither aspect nor any gift body exists, the page is unexpectedly empty
  // — return null so the slot reflects the absence rather than emitting a
  // shell entry.
  if (aspect === null && prereqs === null && activate === null && effect === '') {
    return { gift: null };
  }

  return {
    gift: {
      name:      common.title.name,
      tier,
      aspect,
      traits:    common.traits.traits,
      prereqs,
      activate,
      frequency,
      effect,
    },
  };
}

/**
 * Extract the aspect-aggregator projection from a `?Aspect=N` page. Returns
 * `[]` when the page is a single-gift entry (no subsections or only one).
 */
export function extractRelicAspects(common: CommonExtraction): RelicAspectsSlice {
  const isAggregator = common.sections.length > 1 && /Gift$/i.test(common.sections[0]?.heading ?? '');
  if (!isAggregator) return { aspects: [] };

  const aspects: RelicAspectGift[] = [];
  for (const section of common.sections) {
    const { name, tier } = splitAspectGiftHeading(section.heading);
    if (name === '') continue;
    aspects.push({ name, tier, body: section.body_text });
  }
  return { aspects };
}

/**
 * Extract milestones — reserved slot. AON does not currently render milestone
 * tables on Relics.aspx pages; returns `[]` until/unless source pages start
 * including them.
 */
export function extractRelicMilestones(_common: CommonExtraction): RelicMilestonesSlice {
  return { milestones: [] };
}

/** Extract meta slice marker. */
export function extractRelicMeta(_common: CommonExtraction): RelicMetaSlice {
  return { __relic_meta_marked: true };
}

// ─── Finalize ────────────────────────────────────────────────────────────────

const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Source',
  'Aspect', 'Prerequisite', 'Activate', 'Frequency', 'Effect',
];

export function finalizeRelic(
  common:      CommonExtraction,
  base:        RelicBaseSlice,
  gift:        RelicGiftSlice,
  aspects:     RelicAspectsSlice,
  milestones:  RelicMilestonesSlice,
  _meta:       RelicMetaSlice,
  root:        CheerioAPI,
): RelicOutput {
  void _meta;
  const raw_fields = stripStructuredKeys(common.field_map, CLAIMED_FIELD_LABELS);
  return {
    ...base,
    gift:             gift.gift,
    aspects:          aspects.aspects,
    milestones:       milestones.milestones,
    sections:         common.sections,
    raw_fields,
    links:            common.links,
    body_text:        common.body_text,
    body_html:        common.body_html,
    meta_description: extractMetaDescription(root),
    meta_keywords:    extractMetaKeywords(root),
  } satisfies RelicOutput;
}

/**
 * Project a Relics.aspx page into a typed RelicOutput.
 *
 * Thin assembly wrapper kept for `parseAonHtml` direct-call paths and unit
 * tests. The DAG pipeline calls the per-slice helpers individually through
 * the decomposed relic extraction nodes.
 */
export function extractRelic(
  common: CommonExtraction,
  root:   CheerioAPI,
  _span:  CheerioNode,
): RelicOutput {
  void _span;
  const base       = extractRelicBase(common);
  const gift       = extractRelicGift(common);
  const aspects    = extractRelicAspects(common);
  const milestones = extractRelicMilestones(common);
  const meta       = extractRelicMeta(common);
  return finalizeRelic(common, base, gift, aspects, milestones, meta, root);
}

// Re-export output types so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

export type RelicBaseOutput = 'success' | 'error';

class RelicBaseNode extends ScalarNode<ScrapeState, RelicBaseOutput> {
  public readonly name = 'extract:relic-base';
  public readonly outputs = CAPABILITY_OUTPUTS;
  public override readonly contract: OperationContractFragmentType = {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  };

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<RelicBaseOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const base = extractRelicBase(common);

    state.output = { ...state.output, ...base };

    return NodeOutputBuilder.of('success');
  }
}

export const relicBaseNode = new RelicBaseNode();

// ─────────────────────────────────────────────────────────────────────────────

export type RelicGiftOutput = 'success' | 'error';

class RelicGiftNode extends ScalarNode<ScrapeState, RelicGiftOutput> {
  public readonly name = 'extract:relic-gift';
  public readonly outputs = CAPABILITY_OUTPUTS;
  public override readonly contract: OperationContractFragmentType = {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  };

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<RelicGiftOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const giftSlice    = extractRelicGift(common);
    const aspectsSlice = extractRelicAspects(common);
    const milestones   = extractRelicMilestones(common);

    state.output = state.output !== null
      ? { ...state.output, ...giftSlice, ...aspectsSlice, ...milestones }
      : { ...giftSlice, ...aspectsSlice, ...milestones };

    return NodeOutputBuilder.of('success');
  }
}

export const relicGiftNode = new RelicGiftNode();

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeRelicOutput = 'success';

class FinalizeRelicNode extends ScalarNode<ScrapeState, FinalizeRelicOutput> {
  public readonly name = 'finalize:relic';
  public readonly outputs = ['success'] as const;
  public override readonly contract: OperationContractFragmentType = {
    hardRequired: ['aonprdCommon', 'aonprdCheerio'] as const,
    produces:     [] as const,
  };

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<FinalizeRelicOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root   = state.getMetadata<CheerioAPI>('aonprdCheerio');
    if (common === undefined || root === undefined) return NodeOutputBuilder.of('success');
    const acc = (state.output ?? {}) as unknown as RelicOutput;
    const assembled = finalizeRelic(common, (acc as never), (acc as never), (acc as never), (acc as never), (acc as never), root);
    setConceptOutput(state, assembled);

    return NodeOutputBuilder.of('success');
  }
}

export const finalizeRelicNode = new FinalizeRelicNode();

// ─── ConceptDecl export ───────────────────────────────────────────────────────

export const relicConcept: ConceptDecl<RelicOutput> = {
  id:       'relic',
  parent:   'entity',
  urlPaths: ['relics'],
  capabilities: [
    relicBaseNode,
    relicGiftNode,
    finalizeRelicNode,
  ],
};
