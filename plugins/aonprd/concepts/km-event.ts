//
// Kingmaker kingdom event pages (KMEvents.aspx) carry location, kingdom_skill,
// leader, requirement, special, prose description, and degree-of-success
// outcomes. Helpers are inlined.
//
// bespoke node-folder under nodes/km-event/.
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
  type SourceRef,
  type Section,
  type PfsLegality,
  htmlToText,
  extractEntityId,
  extractMetaDescription,
  extractMetaKeywords,
  stripStructuredKeys,
} from '../common.js';

// ─── Output shape ─────────────────────────────────────────────────────────────

/** A degree-of-success outcome (Critical Success / Success / Failure / Critical Failure). */
export interface KmEventOutcome {
  tier: 'critical-success' | 'success' | 'failure' | 'critical-failure';
  text: string;
}

export interface KmEventOutput {
  url:             string;
  event_id:        number | null;
  name:            string;
  rarity:          Rarity;
  traits:          string[];
  trait_ids:       Record<string, number>;
  /** Numeric event level when AON marks it ("Event +0", "Event 5"). */
  level:           number | null;
  source:          { book: string | null; page: number | null; source_id: number | null };
  sources:         SourceRef[];
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;

  // Mechanics
  location:        string | null;
  kingdom_skill:   string | null;
  leader:          string | null;
  requirement:     string | null;
  special:         string | null;
  /** Prose paragraph describing the event before the outcome list. */
  description:     string;
  /** Degree-of-success outcomes in tier order. */
  outcomes:        KmEventOutcome[];

  // Bookkeeping
  sections:         Section[];
  raw_fields:       Record<string, string>;
  links:            LinkRef[];
  body_text:        string;
  body_html:        string;
  meta_description: string | null;
  meta_keywords:    string | null;
}

export interface KmEventBaseSlice {
  url:             string;
  event_id:        number | null;
  name:            string;
  rarity:          Rarity;
  traits:          string[];
  trait_ids:       Record<string, number>;
  level:           number | null;
  source:          KmEventOutput['source'];
  sources:         SourceRef[];
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;
}

export interface KmEventMechanicsSlice {
  location:      string | null;
  kingdom_skill: string | null;
  leader:        string | null;
  requirement:   string | null;
  special:       string | null;
  description:   string;
  outcomes:      KmEventOutcome[];
}

export interface KmEventMetaSlice {
  __km_event_meta_marked: true;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pickLabelHtml(html: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const labelRe = new RegExp(`<b>\\s*${escaped}\\s*<\\/b>`, 'i');
  const match = labelRe.exec(html);
  if (match === null) return null;
  const start    = match.index + match[0].length;
  const rest     = html.slice(start);
  // Outcomes lines end at the next <b>; field lines end at <br/> or <b> — we
  // use the broader boundary so callers receive everything up to the next
  // label, then trim trailing punctuation themselves.
  const boundary = /<b>|<br\s*\/?>|<\/span>|<h[23]\s+class="title"/i.exec(rest);
  const end      = boundary !== null ? boundary.index : rest.length;
  return rest.slice(0, end);
}

/** Pick the verbatim value up to the next `<b>` only (allow <br/> inside). */
function pickOutcomeHtml(html: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const labelRe = new RegExp(`<b>\\s*${escaped}\\s*<\\/b>`, 'i');
  const match = labelRe.exec(html);
  if (match === null) return null;
  const start    = match.index + match[0].length;
  const rest     = html.slice(start);
  const boundary = /<b>|<\/span>|<h[23]\s+class="title"/i.exec(rest);
  const end      = boundary !== null ? boundary.index : rest.length;
  return rest.slice(0, end);
}

function cleanText(str: string | null): string | null {
  if (str === null) return null;
  const trimmed = str.replace(/[;,]\s*$/, '').trim();
  return trimmed === '' ? null : trimmed;
}

const OUTCOME_LABELS: ReadonlyArray<{ label: string; tier: KmEventOutcome['tier'] }> = [
  { label: 'Critical Success',  tier: 'critical-success' },
  { label: 'Success',           tier: 'success' },
  { label: 'Failure',           tier: 'failure' },
  { label: 'Critical Failure',  tier: 'critical-failure' },
];

function parseOutcomes(body: string): KmEventOutcome[] {
  const out: KmEventOutcome[] = [];
  for (const { label, tier } of OUTCOME_LABELS) {
    const val = pickOutcomeHtml(body, label);
    if (val === null) continue;
    const text = htmlToText(val);
    if (text === '') continue;
    out.push({ tier, text });
  }
  return out;
}

/** Extract the prose description — text between Location/Source line and Kingdom Skill. */
function extractDescription(body: string): string {
  // Description starts after Source/Location <br/> and ends before
  // `<b>Kingdom Skill</b>` or the first outcome label.
  const stopRe = /<b>\s*(?:Kingdom Skill|Critical Success|Success|Failure)\s*<\/b>/i;
  const stop = stopRe.exec(body);
  if (stop === null) return '';
  // Scan backwards for the last <br/> before the stop and a Location/Requirement
  // pattern; take prose between them.
  const head = body.slice(0, stop.index);
  // Last <br/> before stop ends with prose paragraph.
  const lastBrRe = /<br\s*\/?>/gi;
  let lastEnd = 0;
  let prevEnd = 0;
  let match: RegExpExecArray | null;
  while ((match = lastBrRe.exec(head)) !== null) {
    prevEnd = lastEnd;
    lastEnd = match.index + match[0].length;
  }
  void prevEnd;
  // The prose section is everything before the last <br/> (the one that ends
  // the description). Take everything from the previous <br/> (or 0) to it.
  // Simpler heuristic: collect prose runs in head — strip any `<b>Label</b>…<br/>`
  // header lines.
  const prose = head.replace(/<b>[^<]*<\/b>[^<]*(?:<a[^>]*>[^<]*<\/a>[^<]*)*<br\s*\/?>/gi, '');
  return htmlToText(prose).trim();
}

// ─── Per-slice extraction helpers ─────────────────────────────────────────────

export function extractKmEventBase(common: CommonExtraction): KmEventBaseSlice {
  return {
    url:             common.url,
    event_id:        extractEntityId(common.url),
    name:            common.title.name,
    rarity:          common.traits.rarity,
    traits:          common.traits.traits,
    trait_ids:       common.traits.trait_ids,
    level:           common.title.level,
    source:          { book: common.source.book, page: common.source.page, source_id: common.source.source_id },
    sources:         common.sources,
    pfs:             common.title.pfs,
    legacy:          common.title.legacy,
    alt_edition_url: common.title.alt_edition_url,
  };
}

export function extractKmEventMechanics(common: CommonExtraction): KmEventMechanicsSlice {
  const body = common.body_html;
  return {
    location:      cleanText(pickLabelHtml(body, 'Location')      !== null ? htmlToText(pickLabelHtml(body, 'Location')!) : null),
    kingdom_skill: cleanText(pickLabelHtml(body, 'Kingdom Skill') !== null ? htmlToText(pickLabelHtml(body, 'Kingdom Skill')!) : null),
    leader:        cleanText(pickLabelHtml(body, 'Leader')        !== null ? htmlToText(pickLabelHtml(body, 'Leader')!) : null),
    requirement:   cleanText(pickLabelHtml(body, 'Requirement')   !== null ? htmlToText(pickLabelHtml(body, 'Requirement')!) : null),
    special:       cleanText(pickLabelHtml(body, 'Special')       !== null ? htmlToText(pickLabelHtml(body, 'Special')!) : null),
    description:   extractDescription(body),
    outcomes:      parseOutcomes(body),
  };
}

export function extractKmEventMeta(_common: CommonExtraction): KmEventMetaSlice {
  return { __km_event_meta_marked: true };
}

const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Source',
  'Location', 'Kingdom Skill', 'Leader',
  'Requirement', 'Special',
  'Critical Success', 'Success', 'Failure', 'Critical Failure',
];

export function finalizeKmEvent(
  common: CommonExtraction,
  base:   KmEventBaseSlice,
  mech:   KmEventMechanicsSlice,
  _meta:  KmEventMetaSlice,
  root:   CheerioAPI,
): KmEventOutput {
  void _meta;
  return {
    ...base,
    ...mech,
    sections:         common.sections,
    raw_fields:       stripStructuredKeys(common.field_map, CLAIMED_FIELD_LABELS),
    links:            common.links,
    body_text:        common.body_text,
    body_html:        common.body_html,
    meta_description: extractMetaDescription(root),
    meta_keywords:    extractMetaKeywords(root),
  } satisfies KmEventOutput;
}

export function extractKmEvent(common: CommonExtraction, root: CheerioAPI, target: CheerioNode): KmEventOutput {
  void target;
  const base = extractKmEventBase(common);
  const mech = extractKmEventMechanics(common);
  const meta = extractKmEventMeta(common);
  return finalizeKmEvent(common, base, mech, meta, root);
}

// Re-export output type so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

export type KmEventBaseOutput = 'success' | 'error';

class KmEventBaseNodeImpl extends ScalarNode<ScrapeState, KmEventBaseOutput> {
  public readonly name    = 'extract:km-event-base';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<KmEventBaseOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const base = extractKmEventBase(common);

    state.output = { ...state.output, ...base };

    return NodeOutputBuilder.of('success');
  }
}
export const kmEventBaseNode = new KmEventBaseNodeImpl();

// ─────────────────────────────────────────────────────────────────────────────

export type KmEventMechanicsOutput = 'success' | 'error';

class KmEventMechanicsNodeImpl extends ScalarNode<ScrapeState, KmEventMechanicsOutput> {
  public readonly name    = 'extract:km-event-mechanics';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<KmEventMechanicsOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const mech = extractKmEventMechanics(common);

    state.output = { ...state.output, ...mech };

    return NodeOutputBuilder.of('success');
  }
}
export const kmEventMechanicsNode = new KmEventMechanicsNodeImpl();

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeKmEventOutput = 'success';

class FinalizeKmEventNodeImpl extends ScalarNode<ScrapeState, FinalizeKmEventOutput> {
  public readonly name    = 'finalize:km-event';
  public readonly outputs = ['success'] as const;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<FinalizeKmEventOutput>> {
    const common  = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root    = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target  = state.getMetadata<CheerioNode>('aonprdTarget');
    if (common === undefined || root === undefined) return NodeOutputBuilder.of('success');

    // meta arg is unused by finalizeKmEvent (marker only)
    const acc = (state.output ?? {}) as unknown as KmEventOutput;
    const assembled = finalizeKmEvent(common, acc, acc, { __km_event_meta_marked: true }, root);
    void target;

    setConceptOutput(state, assembled);

    return NodeOutputBuilder.of('success');
  }
}
export const finalizeKmEventNode = new FinalizeKmEventNodeImpl();

// ─── ConceptDecl export ───────────────────────────────────────────────────────

export const kmEventConcept: ConceptDecl<KmEventOutput> = {
  id:       'km-event',
  parent:   'entity',
  urlPaths: ['kmevents'],
  capabilities: [
    kmEventBaseNode,
    kmEventMechanicsNode,
    finalizeKmEventNode,
  ],
};
