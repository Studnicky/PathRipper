//
// SetRelics.aspx pages describe linked relic sets with tiered benefits.
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';
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
  getFieldHtml,
  htmlToText,
  splitTopLevel,
  extractEntityId,
  extractMetaDescription,
  extractMetaKeywords,
  stripStructuredKeys,
} from '../common.js';

// ─── Output type ─────────────────────────────────────────────────────────────

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
  const regex = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const href = match[1] ?? '';
    const name = htmlToText(match[2] ?? '');
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
    return splitTopLevel(htmlToText(valueHtml), ',').filter((str) => str !== '');
  }
  return anchors.map((anchor) => anchor.name);
}

/**
 * Parse the `<b>Set Items</b>: …` line into structured component entries. Each
 * item appears as `<u><i><a href="Equipment.aspx?ID=N">name</a></i></u> (level M)`
 * separated by commas at top level.
 */
function parseSetItems(html: string): SetRelicItem[] {
  // Locate the `<b>Set Items</b>:` block.
  const match = /<b>\s*Set\s+Items\s*<\/b>\s*:?\s*([\s\S]*?)(?=<hr|<b>|<h[1-6]\b|$)/i.exec(html);
  if (match === null) return [];
  const block = match[1] ?? '';

  const out: SetRelicItem[] = [];
  // Each component is an anchor (optionally wrapped in `<u><i>…</i></u>`)
  // followed by a `(level N)` marker after one or more closing tags. We match
  // the anchor first and then look ahead through any trailing closing tags to
  // capture the level qualifier.
  const anchorRe = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>((?:<\/[a-z]+>)*\s*\(\s*level\s+(-?\d+)\s*\))?/gi;
  let attackMatch: RegExpExecArray | null;
  while ((attackMatch = anchorRe.exec(block)) !== null) {
    const href  = attackMatch[1] ?? '';
    const name  = htmlToText(attackMatch[2] ?? '');
    if (name === '') continue;
    const lvl   = attackMatch[4] !== undefined ? parseInt(attackMatch[4], 10) : null;
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
  const match = /<b>\s*Gifts\s*<\/b>\s*:?\s*[\s\S]*?<ul>([\s\S]*?)<\/ul>/i.exec(html);
  if (match === null) return [];
  const block = match[1] ?? '';

  const out: SetRelicGift[] = [];
  const liRe = /<li>([\s\S]*?)<\/li>/gi;
  let lastMatch: RegExpExecArray | null;
  while ((lastMatch = liRe.exec(block)) !== null) {
    const inner = lastMatch[1] ?? '';
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
  let lastMatch: RegExpExecArray | null;
  while ((lastMatch = liRe.exec(featBlock)) !== null) {
    const inner  = lastMatch[1] ?? '';
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
export function extractSetRelicBase(common: CommonExtraction): SetRelicBaseSlice {
  return {
    url:             common.url,
    set_relic_id:    extractEntityId(common.url),
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

/** Extract set components, gifts, and tier features. */
export function extractSetRelicComponents(common: CommonExtraction): SetRelicComponentsSlice {
  return {
    aspects:          parseAspects(getFieldHtml(common, 'Aspects')),
    components:       parseSetItems(common.body_html),
    gifts:            parseGifts(common.body_html),
    features:         parseFeatures(common.body_html),
    description_text: buildDescription(common.body_html),
  };
}

/** Extract meta slice marker. */
export function extractSetRelicMeta(_common: CommonExtraction): SetRelicMetaSlice {
  return { __set_relic_meta_marked: true };
}

// ─── Finalize ────────────────────────────────────────────────────────────────

const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Source',
  'Aspects',
];

export function finalizeSetRelic(
  common:      CommonExtraction,
  base:        SetRelicBaseSlice,
  components:  SetRelicComponentsSlice,
  _meta:       SetRelicMetaSlice,
  root:        CheerioAPI,
): SetRelicOutput {
  void _meta;
  void getField;
  const raw_fields = stripStructuredKeys(common.field_map, CLAIMED_FIELD_LABELS);
  return {
    ...base,
    ...components,
    sections:         common.sections,
    raw_fields,
    links:            common.links,
    body_text:        common.body_text,
    body_html:        common.body_html,
    meta_description: extractMetaDescription(root),
    meta_keywords:    extractMetaKeywords(root),
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
  common: CommonExtraction,
  root:   CheerioAPI,
  _span:  CheerioNode,
): SetRelicOutput {
  void _span;
  const base       = extractSetRelicBase(common);
  const components = extractSetRelicComponents(common);
  const meta       = extractSetRelicMeta(common);
  return finalizeSetRelic(common, base, components, meta, root);
}

// Re-export output types so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

export type SetRelicBaseOutput = 'success' | 'error';

class SetRelicBaseNode extends ScalarNode<ScrapeState, SetRelicBaseOutput> {
  public readonly name = 'extract:set-relic-base';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<SetRelicBaseOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const base = extractSetRelicBase(common);

    state.output = { ...state.output, ...base };

    return NodeOutputBuilder.of('success');
  }
}

export const setRelicBaseNode = new SetRelicBaseNode();

// ─────────────────────────────────────────────────────────────────────────────

export type SetRelicComponentsOutput = 'success' | 'error';

class SetRelicComponentsNode extends ScalarNode<ScrapeState, SetRelicComponentsOutput> {
  public readonly name = 'extract:set-relic-components';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<SetRelicComponentsOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const components = extractSetRelicComponents(common);

    state.output = { ...state.output, ...components };

    return NodeOutputBuilder.of('success');
  }
}

export const setRelicComponentsNode = new SetRelicComponentsNode();

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeSetRelicOutput = 'success';

class FinalizeSetRelicNode extends ScalarNode<ScrapeState, FinalizeSetRelicOutput> {
  public readonly name = 'finalize:set-relic';
  public readonly outputs = ['success'] as const;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<FinalizeSetRelicOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root   = state.getMetadata<CheerioAPI>('aonprdCheerio');
    if (common === undefined || root === undefined) return NodeOutputBuilder.of('success');
    const acc = (state.output ?? {}) as unknown as SetRelicOutput;
    const assembled = finalizeSetRelic(common, (acc as never), (acc as never), (acc as never), root);
    setConceptOutput(state, assembled);

    return NodeOutputBuilder.of('success');
  }
}

export const finalizeSetRelicNode = new FinalizeSetRelicNode();

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
