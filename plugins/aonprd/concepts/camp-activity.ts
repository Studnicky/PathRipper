//
// Kingmaker Companion Guide camp action pages (CampActivities.aspx) carry an
// optional action-cost glyph, requirements and frequency head labels, a prose
// description, and degree-of-success outcomes. This concept delegates to Wave 5
// slice helpers in camp-activity.ts for correctness. Output is byte-equivalent
// to the Wave 5 baseline.
//
// bespoke node-folder under nodes/camp-activity/.
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
import { parseOutcomesBlock, outcomesBlockToCampActivity } from '../capabilities/outcomesBlock.js';

// ─── Inlined from Wave 5: camp-activity.ts ──────────────────────────────────
export interface CampActivityOutcome {
  tier: 'critical-success' | 'success' | 'failure' | 'critical-failure';
  text: string;
}

export interface CampActivityOutput {
  url:             string;
  activity_id:     number | null;
  name:            string;
  rarity:          Rarity;
  traits:          string[];
  trait_ids:       Record<string, number>;
  /** Action cost glyph when present in the title. */
  action_cost:     ActionCost | null;
  source:          { book: string | null; page: number | null; source_id: number | null };
  sources:         SourceRef[];
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;

  // Mechanics
  requirements: string | null;
  frequency:    string | null;
  description:  string;
  outcomes:     CampActivityOutcome[];

  // Bookkeeping
  sections:         Section[];
  raw_fields:       Record<string, string>;
  links:            LinkRef[];
  body_text:        string;
  body_html:        string;
  meta_description: string | null;
  meta_keywords:    string | null;
}

export interface CampActivityBaseSlice {
  url:             string;
  activity_id:     number | null;
  name:            string;
  rarity:          Rarity;
  traits:          string[];
  trait_ids:       Record<string, number>;
  action_cost:     ActionCost | null;
  source:          CampActivityOutput['source'];
  sources:         SourceRef[];
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;
}

export interface CampActivityMechanicsSlice {
  requirements: string | null;
  frequency:    string | null;
  description:  string;
  outcomes:     CampActivityOutcome[];
}

export interface CampActivityMetaSlice {
  __camp_activity_meta_marked: true;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseOutcomes(body: string): CampActivityOutcome[] {
  const outcomes = parseOutcomesBlock(body);
  return outcomesBlockToCampActivity(outcomes);
}

function extractDescription(body: string): string {
  const stopRe = /<b>\s*(?:Critical Success|Success|Failure|Critical Failure)\s*<\/b>/i;
  const stop = stopRe.exec(body);
  const slice = stop === null ? body : body.slice(0, stop.index);
  return htmlToText(slice).trim();
}

function clean(s: string | null): string | null {
  if (s === null) return null;
  const t = s.trim().replace(/[;,]\s*$/, '').trim();
  return t === '' ? null : t;
}

// ─── Per-slice extraction helpers ─────────────────────────────────────────────

export function extractCampActivityBase(c: CommonExtraction): CampActivityBaseSlice {
  return {
    url:             c.url,
    activity_id:     extractEntityId(c.url),
    name:            c.title.name,
    rarity:          c.traits.rarity,
    traits:          c.traits.traits,
    trait_ids:       c.traits.trait_ids,
    action_cost:     c.title.action_cost,
    source:          { book: c.source.book, page: c.source.page, source_id: c.source.source_id },
    sources:         c.sources,
    pfs:             c.title.pfs,
    legacy:          c.title.legacy,
    alt_edition_url: c.title.alt_edition_url,
  };
}

export function extractCampActivityMechanics(c: CommonExtraction): CampActivityMechanicsSlice {
  return {
    requirements: clean(getField(c, 'Requirements', 'Requirement')),
    frequency:    clean(getField(c, 'Frequency')),
    description:  extractDescription(c.body_html),
    outcomes:     parseOutcomes(c.body_html),
  };
}

export function extractCampActivityMeta(_c: CommonExtraction): CampActivityMetaSlice {
  return { __camp_activity_meta_marked: true };
}

const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Source',
  'Requirements', 'Requirement', 'Frequency',
  'Critical Success', 'Success', 'Failure', 'Critical Failure',
];

export function finalizeCampActivity(
  c:     CommonExtraction,
  base:  CampActivityBaseSlice,
  mech:  CampActivityMechanicsSlice,
  _meta: CampActivityMetaSlice,
  $:     CheerioAPI,
): CampActivityOutput {
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
  } satisfies CampActivityOutput;
}

export function extractCampActivity(c: CommonExtraction, $: CheerioAPI, target: CheerioNode): CampActivityOutput {
  void target;
  const base = extractCampActivityBase(c);
  const mech = extractCampActivityMechanics(c);
  const meta = extractCampActivityMeta(c);
  return finalizeCampActivity(c, base, mech, meta, $);
}

// Re-export output type so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

export type CampActivityBaseOutput = 'success' | 'error';

export const campActivityBaseNode: NodeInterface<ScrapeState, CampActivityBaseOutput, RipperServices> = {
  name:    'extract:camp-activity-base',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: CampActivityBaseOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const base = extractCampActivityBase(c);

    state.output = { ...state.output, ...base };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type CampActivityMechanicsOutput = 'success' | 'error';

export const campActivityMechanicsNode: NodeInterface<ScrapeState, CampActivityMechanicsOutput, RipperServices> = {
  name:    'extract:camp-activity-mechanics',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: CampActivityMechanicsOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const mech = extractCampActivityMechanics(c);

    state.output = { ...state.output, ...mech };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeCampActivityOutput = 'success';

export const finalizeCampActivityNode: NodeInterface<ScrapeState, FinalizeCampActivityOutput, RipperServices> = {
  name:    'finalize:camp-activity',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FinalizeCampActivityOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined) return { output: 'success' };

    // meta arg is unused by finalizeCampActivity (marker only)
    const acc = (state.output ?? {}) as unknown as CampActivityOutput;
    const assembled = finalizeCampActivity(c, acc, acc, { __camp_activity_meta_marked: true }, $);
    void target;

    setConceptOutput(state, assembled);

    return { output: 'success' };
  },
};

// ─── ConceptDecl export ───────────────────────────────────────────────────────

export const campActivityConcept: ConceptDecl<CampActivityOutput> = {
  id:       'camp-activity',
  parent:   'entity',
  urlPaths: ['campactivities'],
  capabilities: [
    campActivityBaseNode,
    campActivityMechanicsNode,
    finalizeCampActivityNode,
  ],
};
