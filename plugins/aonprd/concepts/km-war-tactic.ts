//
// Kingmaker mass-combat tactic pages (KMWarTactics.aspx) carry army-type tags
// in traits (Infantry/Skirmisher/Cavalry/Siege), a level marker, optional
// prerequisites/requirements/frequency head labels, and prose effect text. This
// Helpers are inlined.
//
// bespoke node-folder under nodes/km-war-tactic/.
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
  getField,
  extractEntityId,
  extractMetaDescription,
  extractMetaKeywords,
  stripStructuredKeys,
} from '../common.js';

export interface KmWarTacticOutput {
  url:             string;
  tactic_id:       number | null;
  name:            string;
  rarity:          Rarity;
  traits:          string[];
  trait_ids:       Record<string, number>;
  /** Tactic level marker. */
  level:           number | null;
  /** Subset of traits matching army-type tags (Infantry/Skirmisher/Cavalry/Siege). */
  army_types:      string[];
  source:          { book: string | null; page: number | null; source_id: number | null };
  sources:         SourceRef[];
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;

  // Mechanics
  prerequisites:   string | null;
  requirements:    string | null;
  frequency:       string | null;
  effect:          string;

  // Bookkeeping
  sections:         Section[];
  raw_fields:       Record<string, string>;
  links:            LinkRef[];
  body_text:        string;
  body_html:        string;
  meta_description: string | null;
  meta_keywords:    string | null;
}

export interface KmWarTacticBaseSlice {
  url:             string;
  tactic_id:       number | null;
  name:            string;
  rarity:          Rarity;
  traits:          string[];
  trait_ids:       Record<string, number>;
  level:           number | null;
  army_types:      string[];
  source:          KmWarTacticOutput['source'];
  sources:         SourceRef[];
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;
}

export interface KmWarTacticMechanicsSlice {
  prerequisites: string | null;
  requirements:  string | null;
  frequency:     string | null;
  effect:        string;
}

export interface KmWarTacticMetaSlice {
  __km_war_tactic_meta_marked: true;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ARMY_TYPE_TAGS: ReadonlySet<string> = new Set(['Infantry', 'Skirmisher', 'Cavalry', 'Siege']);

function pickArmyTypes(traits: ReadonlyArray<string>): string[] {
  const out: string[] = [];
  for (const t of traits) {
    if (ARMY_TYPE_TAGS.has(t)) out.push(t);
  }
  return out;
}

function clean(s: string | null): string | null {
  if (s === null) return null;
  const t = s.trim().replace(/[;,]\s*$/, '').trim();
  return t === '' ? null : t;
}

/**
 * Extract the effect prose from the body. The body holds everything after the
 * Source <br/>; if optional `<b>Prerequisites/Requirements/Frequency</b>`
 * labels are present, strip them out before flattening.
 */
function extractEffect(body: string): string {
  // Remove label/value runs ending with <br/> (e.g. `<b>Prerequisites</b> …<br/>`).
  const cleaned = body.replace(/<b>\s*(?:Prerequisites?|Requirements?|Frequency)\s*<\/b>[\s\S]*?<br\s*\/?>/gi, '');
  return htmlToText(cleaned).trim();
}

// ─── Per-slice extraction helpers ─────────────────────────────────────────────

export function extractKmWarTacticBase(c: CommonExtraction): KmWarTacticBaseSlice {
  return {
    url:             c.url,
    tactic_id:       extractEntityId(c.url),
    name:            c.title.name,
    rarity:          c.traits.rarity,
    traits:          c.traits.traits,
    trait_ids:       c.traits.trait_ids,
    level:           c.title.level,
    army_types:      pickArmyTypes(c.traits.traits),
    source:          { book: c.source.book, page: c.source.page, source_id: c.source.source_id },
    sources:         c.sources,
    pfs:             c.title.pfs,
    legacy:          c.title.legacy,
    alt_edition_url: c.title.alt_edition_url,
  };
}

export function extractKmWarTacticMechanics(c: CommonExtraction): KmWarTacticMechanicsSlice {
  return {
    prerequisites: clean(getField(c, 'Prerequisites', 'Prerequisite')),
    requirements:  clean(getField(c, 'Requirements', 'Requirement')),
    frequency:     clean(getField(c, 'Frequency')),
    effect:        extractEffect(c.body_html),
  };
}

export function extractKmWarTacticMeta(_c: CommonExtraction): KmWarTacticMetaSlice {
  return { __km_war_tactic_meta_marked: true };
}

const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Source',
  'Prerequisites', 'Prerequisite',
  'Requirements', 'Requirement',
  'Frequency',
];

export function finalizeKmWarTactic(
  c:     CommonExtraction,
  base:  KmWarTacticBaseSlice,
  mech:  KmWarTacticMechanicsSlice,
  _meta: KmWarTacticMetaSlice,
  $:     CheerioAPI,
): KmWarTacticOutput {
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
  } satisfies KmWarTacticOutput;
}

export function extractKmWarTactic(c: CommonExtraction, $: CheerioAPI, target: CheerioNode): KmWarTacticOutput {
  void target;
  const base = extractKmWarTacticBase(c);
  const mech = extractKmWarTacticMechanics(c);
  const meta = extractKmWarTacticMeta(c);
  return finalizeKmWarTactic(c, base, mech, meta, $);
}

// Re-export output type so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

export type KmWarTacticBaseOutput = 'success' | 'error';

export const kmWarTacticBaseNode: NodeInterface<ScrapeState, KmWarTacticBaseOutput, RipperServices> = {
  name:    'extract:km-war-tactic-base',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: KmWarTacticBaseOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const base = extractKmWarTacticBase(c);

    state.output = { ...state.output, ...base };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type KmWarTacticMechanicsOutput = 'success' | 'error';

export const kmWarTacticMechanicsNode: NodeInterface<ScrapeState, KmWarTacticMechanicsOutput, RipperServices> = {
  name:    'extract:km-war-tactic-mechanics',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: KmWarTacticMechanicsOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const mech = extractKmWarTacticMechanics(c);

    state.output = { ...state.output, ...mech };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeKmWarTacticOutput = 'success';

export const finalizeKmWarTacticNode: NodeInterface<ScrapeState, FinalizeKmWarTacticOutput, RipperServices> = {
  name:    'finalize:km-war-tactic',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FinalizeKmWarTacticOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined) return { output: 'success' };

    // meta arg is unused by finalizeKmWarTactic (marker only)
    const acc = (state.output ?? {}) as unknown as KmWarTacticOutput;
    const assembled = finalizeKmWarTactic(c, acc, acc, { __km_war_tactic_meta_marked: true }, $);
    void target;

    setConceptOutput(state, assembled);

    return { output: 'success' };
  },
};

// ─── ConceptDecl export ───────────────────────────────────────────────────────

export const kmWarTacticConcept: ConceptDecl<KmWarTacticOutput> = {
  id:       'km-war-tactic',
  parent:   'entity',
  urlPaths: ['kmwartactics'],
  capabilities: [
    kmWarTacticBaseNode,
    kmWarTacticMechanicsNode,
    finalizeKmWarTacticNode,
  ],
};
