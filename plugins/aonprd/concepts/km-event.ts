// KM-event concept — Phase 6.4 taxonomic extraction.
//
// Kingmaker kingdom event pages (KMEvents.aspx) carry location, kingdom_skill,
// leader, requirement, special, prose description, and degree-of-success
// outcomes. This concept delegates to Wave 5 slice helpers in km-event.ts for
// correctness. Output is byte-equivalent to the Wave 5 baseline.
//
// Improvement vs Wave 5: capabilities co-located with inline contracts; no
// bespoke node-folder under nodes/km-event/.
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
  type SourceRef,
  type Section,
  type PfsLegality,
  htmlToText,
  extractEntityId,
  extractMetaDescription,
  extractMetaKeywords,
  stripStructuredKeys,
} from '../common.js';

// ─── Inlined from Wave 5: km-event.ts ──────────────────────────────────
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
  const m = labelRe.exec(html);
  if (m === null) return null;
  const start    = m.index + m[0].length;
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
  const m = labelRe.exec(html);
  if (m === null) return null;
  const start    = m.index + m[0].length;
  const rest     = html.slice(start);
  const boundary = /<b>|<\/span>|<h[23]\s+class="title"/i.exec(rest);
  const end      = boundary !== null ? boundary.index : rest.length;
  return rest.slice(0, end);
}

function cleanText(s: string | null): string | null {
  if (s === null) return null;
  const t = s.replace(/[;,]\s*$/, '').trim();
  return t === '' ? null : t;
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
  let m: RegExpExecArray | null;
  while ((m = lastBrRe.exec(head)) !== null) {
    prevEnd = lastEnd;
    lastEnd = m.index + m[0].length;
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

export function extractKmEventBase(c: CommonExtraction): KmEventBaseSlice {
  return {
    url:             c.url,
    event_id:        extractEntityId(c.url),
    name:            c.title.name,
    rarity:          c.traits.rarity,
    traits:          c.traits.traits,
    trait_ids:       c.traits.trait_ids,
    level:           c.title.level,
    source:          { book: c.source.book, page: c.source.page, source_id: c.source.source_id },
    sources:         c.sources,
    pfs:             c.title.pfs,
    legacy:          c.title.legacy,
    alt_edition_url: c.title.alt_edition_url,
  };
}

export function extractKmEventMechanics(c: CommonExtraction): KmEventMechanicsSlice {
  const body = c.body_html;
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

export function extractKmEventMeta(_c: CommonExtraction): KmEventMetaSlice {
  return { __km_event_meta_marked: true };
}

const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Source',
  'Location', 'Kingdom Skill', 'Leader',
  'Requirement', 'Special',
  'Critical Success', 'Success', 'Failure', 'Critical Failure',
];

export function finalizeKmEvent(
  c:     CommonExtraction,
  base:  KmEventBaseSlice,
  mech:  KmEventMechanicsSlice,
  _meta: KmEventMetaSlice,
  $:     CheerioAPI,
): KmEventOutput {
  void _meta;
  return {
    ...base,
    ...mech,
    sections:         c.sections,
    raw_fields:       stripStructuredKeys(c.field_map, CLAIMED_FIELD_LABELS),
    links:            c.links,
    body_text:        c.body_text,
    body_html:        c.body_html,
    meta_description: extractMetaDescription($),
    meta_keywords:    extractMetaKeywords($),
  } satisfies KmEventOutput;
}

export function extractKmEvent(c: CommonExtraction, $: CheerioAPI, target: CheerioNode): KmEventOutput {
  void target;
  const base = extractKmEventBase(c);
  const mech = extractKmEventMechanics(c);
  const meta = extractKmEventMeta(c);
  return finalizeKmEvent(c, base, mech, meta, $);
}

// Re-export output type so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

export type KmEventBaseOutput = 'success' | 'error';

export const kmEventBaseNode: NodeInterface<ScrapeState, KmEventBaseOutput, RipperServices> = {
  name:    'extract:km-event-base',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: KmEventBaseOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const base = extractKmEventBase(c);

    state.output = { ...state.output, ...base };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type KmEventMechanicsOutput = 'success' | 'error';

export const kmEventMechanicsNode: NodeInterface<ScrapeState, KmEventMechanicsOutput, RipperServices> = {
  name:    'extract:km-event-mechanics',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: KmEventMechanicsOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const mech = extractKmEventMechanics(c);

    state.output = { ...state.output, ...mech };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeKmEventOutput = 'success';

export const finalizeKmEventNode: NodeInterface<ScrapeState, FinalizeKmEventOutput, RipperServices> = {
  name:    'finalize:km-event',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FinalizeKmEventOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined) return { output: 'success' };

    // meta arg is unused by finalizeKmEvent (marker only)
    const acc = (state.output ?? {}) as unknown as KmEventOutput;
    const assembled = finalizeKmEvent(c, acc, acc, { __km_event_meta_marked: true }, $);
    void target;

    setConceptOutput(state, assembled);

    return { output: 'success' };
  },
};

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
