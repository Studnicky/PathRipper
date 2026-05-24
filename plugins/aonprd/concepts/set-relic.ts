//
// Byte-equivalent to Wave 5 SetRelicOutput shape.
// SetRelics.aspx pages describe linked relic sets with tiered benefits.
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
  getField,
  getFieldHtml,
  htmlToText,
  splitTopLevel,
  extractEntityId,
  extractMetaDescription,
  extractMetaKeywords,
  stripStructuredKeys,
} from '../common.js';

// ─── Inlined from Wave 5: set-relic.ts ──────────────────────────────────
// ─── Output type ──────────────────────────────────────────────────────────────

/** A single set-item component (an equipment piece bound to the set). */
export interface SetRelicItem {
  /** Display name (e.g. "+1 rapier"). */
  name:         string;
  /** AON Equipment.aspx ID, when the anchor carries `?ID=N`. */
  equipment_id: number | null;
  /** Verbatim href from the anchor (may be relative). */
  href:         string | null;
  /** Item level pulled from the trailing `(level N)` marker. */
  level:        number | null;
}

/** A tier gift — the gift granted at tier N of the set. */
export interface SetRelicGift {
  /** Set tier (1-based — the Nth piece). */
  tier:     number;
  /** Display name of the gift. */
  name:     string;
  /** AON Relics.aspx ID, when the gift link carries `?ID=N`. */
  relic_id: number | null;
  /** Verbatim href from the anchor (may be relative). */
  href:     string | null;
}

/** A tier feature — describes the benefit at tier N. */
export interface SetRelicFeature {
  /** Tier label (e.g. `Two Items`, `Three Items`, `Five Items`). */
  tier_label: string;
  /** Free-form body text. */
  text:       string;
}

export interface SetRelicOutput {
  url:              string;
  /** Numeric AON SetRelics.aspx ID extracted from the URL query string. */
  set_relic_id:     number | null;
  name:             string;
  rarity:           Rarity;
  pfs:              PfsLegality | null;
  legacy:           boolean;
  alt_edition_url:  string | null;
  traits:           string[];
  trait_ids:        Record<string, number>;
  source:           { book: string | null; page: number | null; source_id: number | null };
  sources:          SourceRef[];

  // ─── Components ────────────────────────────────────────────────────────────
  /** Aspect labels (e.g. `["emotion", "luck"]`) from the `<b>Aspects</b>` line. */
  aspects:          string[];
  /** Constituent set items in tier order. */
  components:       SetRelicItem[];
  /** Tier gifts granted by the set. */
  gifts:            SetRelicGift[];
  /** Tier features describing per-tier benefits. */
  features:         SetRelicFeature[];
  /** Flavor description prose preceding the Set Items / Gifts / Features blocks. */
  description_text: string;

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

export interface SetRelicBaseSlice {
  url:             string;
  set_relic_id:    number | null;
  name:            string;
  rarity:          Rarity;
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;
  traits:          string[];
  trait_ids:       Record<string, number>;
  source:          SetRelicOutput['source'];
  sources:         SourceRef[];
}

export interface SetRelicComponentsSlice {
  aspects:          string[];
  components:       SetRelicItem[];
  gifts:            SetRelicGift[];
  features:         SetRelicFeature[];
  description_text: string;
}

export interface SetRelicMetaSlice {
  __set_relic_meta_marked: true;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ANCHOR_RE = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i;

/** Pull every anchor in the value, capturing href + name. */
function harvestAnchors(html: string): Array<{ href: string; name: string }> {
  const out: Array<{ href: string; name: string }> = [];
  const re = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1] ?? '';
    const name = htmlToText(m[2] ?? '');
    if (name === '') continue;
    out.push({ href, name });
  }
  return out;
}

/** Parse the `<b>Aspects</b>` linked list into bare aspect names. */
function parseAspects(valueHtml: string | null): string[] {
  if (valueHtml === null) return [];
  const anchors = harvestAnchors(valueHtml);
  if (anchors.length === 0) {
    // Plain-text fallback.
    return splitTopLevel(htmlToText(valueHtml), ',').filter((s) => s !== '');
  }
  return anchors.map((a) => a.name);
}

/**
 * Parse the `<b>Set Items</b>: …` line into structured component entries. Each
 * item appears as `<u><i><a href="Equipment.aspx?ID=N">name</a></i></u> (level M)`
 * separated by commas at top level.
 */
function parseSetItems(html: string): SetRelicItem[] {
  // Locate the `<b>Set Items</b>:` block.
  const m = /<b>\s*Set\s+Items\s*<\/b>\s*:?\s*([\s\S]*?)(?=<hr|<b>|<h[1-6]\b|$)/i.exec(html);
  if (m === null) return [];
  const block = m[1] ?? '';

  const out: SetRelicItem[] = [];
  // Each component is an anchor (optionally wrapped in `<u><i>…</i></u>`)
  // followed by a `(level N)` marker after one or more closing tags. We match
  // the anchor first and then look ahead through any trailing closing tags to
  // capture the level qualifier.
  const anchorRe = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>((?:<\/[a-z]+>)*\s*\(\s*level\s+(-?\d+)\s*\))?/gi;
  let am: RegExpExecArray | null;
  while ((am = anchorRe.exec(block)) !== null) {
    const href  = am[1] ?? '';
    const name  = htmlToText(am[2] ?? '');
    if (name === '') continue;
    const lvl   = am[4] !== undefined ? parseInt(am[4], 10) : null;
    const idM   = /\?ID=(\d+)/i.exec(href);
    const equipment_id = idM !== null ? parseInt(idM[1]!, 10) : null;
    out.push({
      name,
      equipment_id,
      href,
      level: lvl !== null && Number.isFinite(lvl) ? lvl : null,
    });
  }
  return out;
}

/**
 * Parse the `<b>Gifts</b>` `<ul>` block — each `<li>` is `<i>N</i>: <u><a href="Relics.aspx?ID=M">name</a></u>`.
 */
function parseGifts(html: string): SetRelicGift[] {
  // Locate the `<b>Gifts</b>:` block, capturing up to the next `<hr />` or `<b>`.
  const m = /<b>\s*Gifts\s*<\/b>\s*:?\s*[\s\S]*?<ul>([\s\S]*?)<\/ul>/i.exec(html);
  if (m === null) return [];
  const block = m[1] ?? '';

  const out: SetRelicGift[] = [];
  const liRe = /<li>([\s\S]*?)<\/li>/gi;
  let lm: RegExpExecArray | null;
  while ((lm = liRe.exec(block)) !== null) {
    const inner = lm[1] ?? '';
    const tierMatch = /<i>\s*(\d+)\s*<\/i>/i.exec(inner);
    if (tierMatch === null) continue;
    const tier = parseInt(tierMatch[1]!, 10);
    const anchorMatch = ANCHOR_RE.exec(inner);
    if (anchorMatch === null) continue;
    const href = anchorMatch[1] ?? '';
    const name = htmlToText(anchorMatch[2] ?? '');
    if (name === '' || !Number.isFinite(tier)) continue;
    const idM = /\?ID=(\d+)/i.exec(href);
    const relic_id = idM !== null ? parseInt(idM[1]!, 10) : null;
    out.push({ tier, name, relic_id, href });
  }
  return out;
}

/**
 * Parse the tier-feature list — `<ul><li><i>Two Items</i>: …`. AON renders the
 * feature list after the Gifts block, separated by additional `<hr />` and prose.
 */
function parseFeatures(html: string): SetRelicFeature[] {
  // Match the SECOND <ul> in the body (the first one is the gift list).
  const ulMatches = html.match(/<ul>[\s\S]*?<\/ul>/gi) ?? [];
  if (ulMatches.length < 2) return [];
  const featBlock = ulMatches[ulMatches.length - 1]!;

  const out: SetRelicFeature[] = [];
  const liRe = /<li>([\s\S]*?)<\/li>/gi;
  let lm: RegExpExecArray | null;
  while ((lm = liRe.exec(featBlock)) !== null) {
    const inner  = lm[1] ?? '';
    const labelM = /<i>\s*([^<]+?)\s*<\/i>\s*:?\s*([\s\S]*)/i.exec(inner);
    if (labelM === null) continue;
    const tier_label = (labelM[1] ?? '').trim();
    const text       = htmlToText(labelM[2] ?? '');
    if (tier_label === '' || text === '') continue;
    out.push({ tier_label, text });
  }
  return out;
}

/** Slice the flavor description prose from the body. */
function buildDescription(bodyHtml: string): string {
  // `body_html` starts after the header `<hr />` split (common.ts splitOnHr),
  // so the description prose is the leading run of HTML up to `<b>Set Items</b>`.
  const itemsIdx = bodyHtml.search(/<b>\s*Set\s+Items\s*<\/b>/i);
  const slice = itemsIdx === -1 ? bodyHtml : bodyHtml.slice(0, itemsIdx);
  // Strip a trailing `<hr />` that bridges description and set-items label.
  const cleaned = slice.replace(/<hr\s*\/?>\s*$/i, '').trim();
  return htmlToText(cleaned);
}

// ─── Per-slice extraction helpers ─────────────────────────────────────────────

/** Extract base identity + header scalars for a set-relic page. */
export function extractSetRelicBase(c: CommonExtraction): SetRelicBaseSlice {
  return {
    url:             c.url,
    set_relic_id:    extractEntityId(c.url),
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

/** Extract set components, gifts, and tier features. */
export function extractSetRelicComponents(c: CommonExtraction): SetRelicComponentsSlice {
  return {
    aspects:          parseAspects(getFieldHtml(c, 'Aspects')),
    components:       parseSetItems(c.body_html),
    gifts:            parseGifts(c.body_html),
    features:         parseFeatures(c.body_html),
    description_text: buildDescription(c.body_html),
  };
}

/** Extract meta slice marker. */
export function extractSetRelicMeta(_c: CommonExtraction): SetRelicMetaSlice {
  return { __set_relic_meta_marked: true };
}

// ─── Finalize ────────────────────────────────────────────────────────────────

const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Source',
  'Aspects',
];

export function finalizeSetRelic(
  c:           CommonExtraction,
  base:        SetRelicBaseSlice,
  components:  SetRelicComponentsSlice,
  _meta:       SetRelicMetaSlice,
  $:           CheerioAPI,
): SetRelicOutput {
  void _meta;
  void getField;
  const raw_fields = stripStructuredKeys(c.field_map, CLAIMED_FIELD_LABELS);
  return {
    ...base,
    ...components,
    sections:         c.sections,
    raw_fields,
    links:            c.links,
    body_text:        c.body_text,
    body_html:        c.body_html,
    meta_description: extractMetaDescription($),
    meta_keywords:    extractMetaKeywords($),
  } satisfies SetRelicOutput;
}

/**
 * Project a SetRelics.aspx page into a typed SetRelicOutput.
 *
 * Thin assembly wrapper kept for `parseAonHtml` direct-call paths and unit
 * tests. The DAG pipeline calls the per-slice helpers individually through
 * the decomposed set-relic extraction nodes.
 */
export function extractSetRelic(
  c:      CommonExtraction,
  $:      CheerioAPI,
  _span:  CheerioNode,
): SetRelicOutput {
  void _span;
  const base       = extractSetRelicBase(c);
  const components = extractSetRelicComponents(c);
  const meta       = extractSetRelicMeta(c);
  return finalizeSetRelic(c, base, components, meta, $);
}

// Re-export output types so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

export type SetRelicBaseOutput = 'success' | 'error';

export const setRelicBaseNode: NodeInterface<ScrapeState, SetRelicBaseOutput, RipperServices> = {
  name:    'extract:set-relic-base',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: SetRelicBaseOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const base = extractSetRelicBase(c);

    state.output = { ...state.output, ...base };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type SetRelicComponentsOutput = 'success' | 'error';

export const setRelicComponentsNode: NodeInterface<ScrapeState, SetRelicComponentsOutput, RipperServices> = {
  name:    'extract:set-relic-components',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: SetRelicComponentsOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const components = extractSetRelicComponents(c);

    state.output = { ...state.output, ...components };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeSetRelicOutput = 'success';

export const finalizeSetRelicNode: NodeInterface<ScrapeState, FinalizeSetRelicOutput, RipperServices> = {
  name:    'finalize:set-relic',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FinalizeSetRelicOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $ = state.getMetadata<CheerioAPI>('aonprdCheerio');
    if (c === undefined || $ === undefined) return { output: 'success' };
    const acc = (state.output ?? {}) as unknown as SetRelicOutput;
    const assembled = finalizeSetRelic(c, (acc as never), (acc as never), (acc as never), $);
    setConceptOutput(state, assembled);

    return { output: 'success' };
  },
};

// ─── ConceptDecl export ───────────────────────────────────────────────────────

export const setRelicConcept: ConceptDecl<SetRelicOutput> = {
  id:       'set-relic',
  parent:   'entity',
  urlPaths: ['setrelics'],
  capabilities: [
    setRelicBaseNode,
    setRelicComponentsNode,
    finalizeSetRelicNode,
  ],
};
