//
// Commander class squad-tactic pages (Tactics.aspx) carry an action-cost glyph,
// a category/tier marker, optional prerequisites/requirements/trigger/frequency
// head labels, an effect body, and an optional Special callout. This concept
// delegates to Wave 5 slice helpers in tactic.ts for correctness. Output is
//
// bespoke node-folder under nodes/tactic/.
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
  type ActionCost,
  htmlToText,
  getField,
  extractEntityId,
  extractMetaDescription,
  extractMetaKeywords,
  stripStructuredKeys,
} from '../common.js';

// ─── Inlined from Wave 5: tactic.ts ──────────────────────────────────
export interface TacticOutput {
  url:             string;
  tactic_id:       number | null;
  name:            string;
  rarity:          Rarity;
  traits:          string[];
  trait_ids:       Record<string, number>;
  /** Action-cost glyph in the title (one-action, two-actions, reaction, etc). */
  action_cost:     ActionCost | null;
  /** Right-floated marker on the title — category/tier ("Mobility", "Master"). */
  category:        string | null;
  source:          { book: string | null; page: number | null; source_id: number | null };
  sources:         SourceRef[];
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;

  // Mechanics
  prerequisites:   string | null;
  requirements:    string | null;
  trigger:         string | null;
  frequency:       string | null;
  effect:          string;
  special:         string | null;

  // Bookkeeping
  sections:         Section[];
  raw_fields:       Record<string, string>;
  links:            LinkRef[];
  body_text:        string;
  body_html:        string;
  meta_description: string | null;
  meta_keywords:    string | null;
}

export interface TacticBaseSlice {
  url:             string;
  tactic_id:       number | null;
  name:            string;
  rarity:          Rarity;
  traits:          string[];
  trait_ids:       Record<string, number>;
  action_cost:     ActionCost | null;
  category:        string | null;
  source:          TacticOutput['source'];
  sources:         SourceRef[];
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;
}

export interface TacticMechanicsSlice {
  prerequisites: string | null;
  requirements:  string | null;
  trigger:       string | null;
  frequency:     string | null;
  effect:        string;
  special:       string | null;
}

export interface TacticMetaSlice {
  __tactic_meta_marked: true;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pickValue(body: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const labelRe = new RegExp(`<b>\\s*${escaped}\\s*<\\/b>`, 'i');
  const m = labelRe.exec(body);
  if (m === null) return null;
  const start    = m.index + m[0].length;
  const rest     = body.slice(start);
  const boundary = /<b>|<br\s*\/?>|<\/span>|<h[23]\s+class="title"/i.exec(rest);
  const end      = boundary !== null ? boundary.index : rest.length;
  const value    = rest.slice(0, end).trim();
  if (value === '') return null;
  return value;
}

function clean(s: string | null): string | null {
  if (s === null) return null;
  const t = s.replace(/[;,]\s*$/, '').trim();
  return t === '' ? null : t;
}

// ─── Per-slice extraction helpers ─────────────────────────────────────────────

export function extractTacticBase(c: CommonExtraction): TacticBaseSlice {
  // Tactics' right-floated marker is the proficiency tier or category — not a
  // level. level_kind captures the marker prefix word.
  return {
    url:             c.url,
    tactic_id:       extractEntityId(c.url),
    name:            c.title.name,
    rarity:          c.traits.rarity,
    traits:          c.traits.traits,
    trait_ids:       c.traits.trait_ids,
    action_cost:     c.title.action_cost,
    category:        c.title.level_label,
    source:          { book: c.source.book, page: c.source.page, source_id: c.source.source_id },
    sources:         c.sources,
    pfs:             c.title.pfs,
    legacy:          c.title.legacy,
    alt_edition_url: c.title.alt_edition_url,
  };
}

export function extractTacticMechanics(c: CommonExtraction): TacticMechanicsSlice {
  // Head labels: Prerequisites/Requirements/Trigger/Frequency live in fields
  // (head, before <hr/>) — read via the canonical field_map first, fall back
  // to value scanning if absent.
  const fromField = (key: string): string | null => clean(getField(c, key));

  // Effect is the post-<hr/> body, minus a trailing `<b>Special</b>` block.
  const body    = c.body_html;
  const specRe  = /<b>\s*Special\s*<\/b>/i;
  const specM   = specRe.exec(body);
  const effectHtml = specM === null ? body : body.slice(0, specM.index);
  const effect  = htmlToText(effectHtml).trim();

  // `<b>Special</b>` value runs to end of span.
  let special: string | null = null;
  if (specM !== null) {
    const tail = body.slice(specM.index + specM[0].length);
    const stop = /<\/span>/i.exec(tail);
    const end  = stop !== null ? stop.index : tail.length;
    special = htmlToText(tail.slice(0, end)).trim();
    if (special === '') special = null;
  }

  return {
    prerequisites: fromField('Prerequisites') ?? fromField('Prerequisite'),
    requirements:  fromField('Requirements')  ?? fromField('Requirement'),
    trigger:       fromField('Trigger'),
    frequency:     fromField('Frequency'),
    effect,
    special,
  };
  void pickValue;
}

export function extractTacticMeta(_c: CommonExtraction): TacticMetaSlice {
  return { __tactic_meta_marked: true };
}

const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Source',
  'Prerequisites', 'Prerequisite',
  'Requirements', 'Requirement',
  'Trigger', 'Frequency',
];

export function finalizeTactic(
  c:     CommonExtraction,
  base:  TacticBaseSlice,
  mech:  TacticMechanicsSlice,
  _meta: TacticMetaSlice,
  $:     CheerioAPI,
): TacticOutput {
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
  } satisfies TacticOutput;
}

export function extractTactic(c: CommonExtraction, $: CheerioAPI, target: CheerioNode): TacticOutput {
  void target;
  const base = extractTacticBase(c);
  const mech = extractTacticMechanics(c);
  const meta = extractTacticMeta(c);
  return finalizeTactic(c, base, mech, meta, $);
}

// Re-export output type so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

export type TacticBaseOutput = 'success' | 'error';

export const tacticBaseNode: NodeInterface<ScrapeState, TacticBaseOutput, RipperServices> = {
  name:    'extract:tactic-base',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: TacticBaseOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const base = extractTacticBase(c);

    state.output = { ...state.output, ...base };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type TacticMechanicsOutput = 'success' | 'error';

export const tacticMechanicsNode: NodeInterface<ScrapeState, TacticMechanicsOutput, RipperServices> = {
  name:    'extract:tactic-mechanics',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: TacticMechanicsOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const mech = extractTacticMechanics(c);

    state.output = { ...state.output, ...mech };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeTacticOutput = 'success';

export const finalizeTacticNode: NodeInterface<ScrapeState, FinalizeTacticOutput, RipperServices> = {
  name:    'finalize:tactic',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FinalizeTacticOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined) return { output: 'success' };

    // meta arg is unused by finalizeTactic (marker only)
    const acc = (state.output ?? {}) as unknown as TacticOutput;
    const assembled = finalizeTactic(c, acc, acc, { __tactic_meta_marked: true }, $);
    void target;

    setConceptOutput(state, assembled);

    return { output: 'success' };
  },
};

// ─── ConceptDecl export ───────────────────────────────────────────────────────

export const tacticConcept: ConceptDecl<TacticOutput> = {
  id:       'tactic',
  parent:   'entity',
  urlPaths: ['tactics'],
  capabilities: [
    tacticBaseNode,
    tacticMechanicsNode,
    finalizeTacticNode,
  ],
};
