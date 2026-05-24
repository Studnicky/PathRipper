// Relic concept — Phase 6.4 taxonomic extraction.
//
// Delegates to Wave 5 slice helpers in relic.ts for correctness.
// Byte-equivalent to Wave 5 RelicOutput shape, which covers both single-gift
// pages (?ID=N) and aspect-aggregator pages (?Aspect=N) under one concept.
import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState }    from '../../../src/state/ScrapeState.js';
import type { RipperServices } from '../../../src/services/RipperServices.js';
import type { ConceptDecl, ConceptOutputBase } from '../taxonomy.js';
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

// ─── Inlined from Wave 5: relic.ts ──────────────────────────────────
// ─── Output type ──────────────────────────────────────────────────────────────

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

export interface RelicOutputFields {
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

/** Full output shape — `_type` discriminator stamped by the router at chain entry. */
export type RelicOutput = ConceptOutputBase<'relic'> & RelicOutputFields;

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
  source:          RelicOutputFields['source'];
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
  const m = /[?&]Aspect=(\d+)/i.exec(url);
  if (m === null) return null;
  const n = parseInt(m[1]!, 10);
  return Number.isFinite(n) ? n : null;
}

/** Read the right-floated tier marker from the title (`Minor Gift`, `Major Gift`, `Grand Gift`). */
function readTier(c: CommonExtraction): string | null {
  return c.title.level_label;
}

/**
 * Pull the verbatim `<b>Label</b> value` text from the head fragment without
 * needing the value to live in `field_map`. AON sometimes splits Aspect /
 * Prerequisite across a `;` so harvestFields() captures them as expected, but
 * we add this as a defensive fallback.
 */
function readHeadField(headHtml: string, label: string): string | null {
  const re = new RegExp(`<b>\\s*${label}\\s*</b>([\\s\\S]*?)(?=<b>|<br|<hr|$)`, 'i');
  const m = re.exec(headHtml);
  if (m === null) return null;
  const text = htmlToText(m[1] ?? '').replace(/[;,]\s*$/, '').trim();
  return text === '' ? null : text;
}

/**
 * Parse the gift-tier marker out of a subsection heading like
 * `Deadly Spark Minor Gift`. AON renders each aggregator gift as a `<h2>` whose
 * inner text concatenates the link name and the right-floated tier span.
 */
function splitAspectGiftHeading(heading: string): { name: string; tier: string | null } {
  const m = /^(.*?)\s+(Minor|Major|Grand|Greater|Lesser)\s+Gift$/i.exec(heading.trim());
  if (m === null) {
    return { name: heading.trim(), tier: null };
  }
  return { name: (m[1] ?? '').trim(), tier: `${m[2]} Gift` };
}

// ─── Per-slice extraction helpers ─────────────────────────────────────────────

/** Extract base identity + header scalars for a relic page. */
export function extractRelicBase(c: CommonExtraction): RelicBaseSlice {
  return {
    url:             c.url,
    relic_id:        extractEntityId(c.url),
    aspect_id:       extractAspectId(c.url),
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
 * Extract the single-gift projection from a `?ID=N` page. Returns `null` when
 * the page is an aspect aggregator (no Aspect/Prerequisite field map, body
 * dominated by `<h2>` subsections).
 *
 * AON renders gift bodies as a single body fragment after the header `<hr />`,
 * with inline `<b>Activate</b>`/`<b>Frequency</b>`/`<b>Effect</b>` labels that
 * do not appear in the harvested header `field_map`. We lift them from the
 * body HTML directly so structured fields populate consistently.
 */
export function extractRelicGift(c: CommonExtraction): RelicGiftSlice {
  // Aggregator pages have multiple sub-gift `<h2 class="title">` blocks and
  // either no aspect field on the header or a `<h1>Relics</h1>` placeholder.
  const isAggregator = c.sections.length > 1 && /Gift$/i.test(c.sections[0]?.heading ?? '');
  if (isAggregator) return { gift: null };

  const aspect    = dashToNull(getField(c, 'Aspect'));
  const prereqs   = dashToNull(getField(c, 'Prerequisite'));
  const activate  = dashToNull(getField(c, 'Activate'))   ?? readHeadField(c.body_html, 'Activate');
  const frequency = dashToNull(getField(c, 'Frequency'))  ?? readHeadField(c.body_html, 'Frequency');
  const tier      = readTier(c);
  const effectRaw = dashToNull(getField(c, 'Effect'))     ?? readHeadField(c.body_html, 'Effect');
  // When the body has no labeled `Effect` block (gift body is pure prose) the
  // entire body_text is the effect; otherwise prefer the labeled portion.
  const effect    = effectRaw ?? c.body_text.trim();

  // If neither aspect nor any gift body exists, the page is unexpectedly empty
  // — return null so the slot reflects the absence rather than emitting a
  // shell entry.
  if (aspect === null && prereqs === null && activate === null && effect === '') {
    return { gift: null };
  }

  return {
    gift: {
      name:      c.title.name,
      tier,
      aspect,
      traits:    c.traits.traits,
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
export function extractRelicAspects(c: CommonExtraction): RelicAspectsSlice {
  const isAggregator = c.sections.length > 1 && /Gift$/i.test(c.sections[0]?.heading ?? '');
  if (!isAggregator) return { aspects: [] };

  const aspects: RelicAspectGift[] = [];
  for (const section of c.sections) {
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
export function extractRelicMilestones(_c: CommonExtraction): RelicMilestonesSlice {
  return { milestones: [] };
}

/** Extract meta slice marker. */
export function extractRelicMeta(_c: CommonExtraction): RelicMetaSlice {
  return { __relic_meta_marked: true };
}

// ─── Finalize ────────────────────────────────────────────────────────────────

const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Source',
  'Aspect', 'Prerequisite', 'Activate', 'Frequency', 'Effect',
];

export function finalizeRelic(
  c:           CommonExtraction,
  base:        RelicBaseSlice,
  gift:        RelicGiftSlice,
  aspects:     RelicAspectsSlice,
  milestones:  RelicMilestonesSlice,
  _meta:       RelicMetaSlice,
  $:           CheerioAPI,
): RelicOutputFields {
  void _meta;
  const raw_fields = stripStructuredKeys(c.field_map, CLAIMED_FIELD_LABELS);
  return {
    ...base,
    gift:             gift.gift,
    aspects:          aspects.aspects,
    milestones:       milestones.milestones,
    sections:         c.sections,
    raw_fields,
    links:            c.links,
    body_text:        c.body_text,
    body_html:        c.body_html,
    meta_description: extractMetaDescription($),
    meta_keywords:    extractMetaKeywords($),
  } satisfies RelicOutputFields;
}

/**
 * Project a Relics.aspx page into a typed RelicOutput.
 *
 * Thin assembly wrapper kept for `parseAonHtml` direct-call paths and unit
 * tests. The DAG pipeline calls the per-slice helpers individually through
 * the decomposed relic extraction nodes.
 */
export function extractRelic(
  c:      CommonExtraction,
  $:      CheerioAPI,
  _span:  CheerioNode,
): RelicOutputFields {
  void _span;
  const base       = extractRelicBase(c);
  const gift       = extractRelicGift(c);
  const aspects    = extractRelicAspects(c);
  const milestones = extractRelicMilestones(c);
  const meta       = extractRelicMeta(c);
  return finalizeRelic(c, base, gift, aspects, milestones, meta, $);
}


// Re-export output types so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

export type RelicBaseOutput = 'success' | 'error';

export const relicBaseNode: NodeInterface<ScrapeState, RelicBaseOutput, RipperServices> = {
  name:    'extract:relic-base',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: RelicBaseOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const base = extractRelicBase(c);

    state.output = { ...state.output, ...base };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type RelicGiftOutput = 'success' | 'error';

export const relicGiftNode: NodeInterface<ScrapeState, RelicGiftOutput, RipperServices> = {
  name:    'extract:relic-gift',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: RelicGiftOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const giftSlice    = extractRelicGift(c);
    const aspectsSlice = extractRelicAspects(c);
    const milestones   = extractRelicMilestones(c);

    state.output = state.output !== null
      ? { ...state.output, ...giftSlice, ...aspectsSlice, ...milestones }
      : { ...giftSlice, ...aspectsSlice, ...milestones };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeRelicOutput = 'success';

export const finalizeRelicNode: NodeInterface<ScrapeState, FinalizeRelicOutput, RipperServices> = {
  name:    'finalize:relic',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FinalizeRelicOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $ = state.getMetadata<CheerioAPI>('aonprdCheerio');
    if (c === undefined || $ === undefined) return { output: 'success' };
    const acc = (state.output ?? {}) as unknown as RelicOutput;
    const assembled = finalizeRelic(c, (acc as never), (acc as never), (acc as never), (acc as never), (acc as never), $);
    setConceptOutput(state, assembled);

    return { output: 'success' };
  },
};

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
  discriminator: { _type: 'relic' },
};
