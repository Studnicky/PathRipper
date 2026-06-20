//
// Kingmaker Companion Guide camp action pages (CampActivities.aspx) carry an
// optional action-cost glyph, requirements and frequency head labels, a prose
// description, and degree-of-success outcomes. Helpers are inlined.
//
// bespoke node-folder under nodes/camp-activity/.
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
  type ActionCost,
  htmlToText,
  getField,
  extractEntityId,
  extractMetaDescription,
  extractMetaKeywords,
  stripStructuredKeys,
} from '../common.js';
import { parseOutcomesBlock, outcomesBlockToCampActivity } from '../capabilities/outcomesBlock.js';

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

function clean(str: string | null): string | null {
  if (str === null) return null;
  const trimmed = str.trim().replace(/[;,]\s*$/, '').trim();
  return trimmed === '' ? null : trimmed;
}

// ─── Per-slice extraction helpers ─────────────────────────────────────────────

export function extractCampActivityBase(common: CommonExtraction): CampActivityBaseSlice {
  return {
    url:             common.url,
    activity_id:     extractEntityId(common.url),
    name:            common.title.name,
    rarity:          common.traits.rarity,
    traits:          common.traits.traits,
    trait_ids:       common.traits.trait_ids,
    action_cost:     common.title.action_cost,
    source:          { book: common.source.book, page: common.source.page, source_id: common.source.source_id },
    sources:         common.sources,
    pfs:             common.title.pfs,
    legacy:          common.title.legacy,
    alt_edition_url: common.title.alt_edition_url,
  };
}

export function extractCampActivityMechanics(common: CommonExtraction): CampActivityMechanicsSlice {
  return {
    requirements: clean(getField(common, 'Requirements', 'Requirement')),
    frequency:    clean(getField(common, 'Frequency')),
    description:  extractDescription(common.body_html),
    outcomes:     parseOutcomes(common.body_html),
  };
}

export function extractCampActivityMeta(_common: CommonExtraction): CampActivityMetaSlice {
  return { __camp_activity_meta_marked: true };
}

const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Source',
  'Requirements', 'Requirement', 'Frequency',
  'Critical Success', 'Success', 'Failure', 'Critical Failure',
];

export function finalizeCampActivity(
  common: CommonExtraction,
  base:   CampActivityBaseSlice,
  mech:   CampActivityMechanicsSlice,
  _meta:  CampActivityMetaSlice,
  root:   CheerioAPI,
): CampActivityOutput {
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
  } satisfies CampActivityOutput;
}

export function extractCampActivity(common: CommonExtraction, root: CheerioAPI, target: CheerioNode): CampActivityOutput {
  void target;
  const base = extractCampActivityBase(common);
  const mech = extractCampActivityMechanics(common);
  const meta = extractCampActivityMeta(common);
  return finalizeCampActivity(common, base, mech, meta, root);
}

// Re-export output type so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

export type CampActivityBaseOutput = 'success' | 'error';

class CampActivityBaseNode extends ScalarNode<ScrapeState, CampActivityBaseOutput> {
  public readonly name = 'extract:camp-activity-base';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<CampActivityBaseOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const base = extractCampActivityBase(common);

    state.output = { ...state.output, ...base };

    return NodeOutputBuilder.of('success');
  }
}

export const campActivityBaseNode = new CampActivityBaseNode();

// ─────────────────────────────────────────────────────────────────────────────

export type CampActivityMechanicsOutput = 'success' | 'error';

class CampActivityMechanicsNode extends ScalarNode<ScrapeState, CampActivityMechanicsOutput> {
  public readonly name = 'extract:camp-activity-mechanics';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<CampActivityMechanicsOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const mech = extractCampActivityMechanics(common);

    state.output = { ...state.output, ...mech };

    return NodeOutputBuilder.of('success');
  }
}

export const campActivityMechanicsNode = new CampActivityMechanicsNode();

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeCampActivityOutput = 'success';

class FinalizeCampActivityNode extends ScalarNode<ScrapeState, FinalizeCampActivityOutput> {
  public readonly name = 'finalize:camp-activity';
  public readonly outputs = ['success'] as const;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<FinalizeCampActivityOutput>> {
    const common  = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root    = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target  = state.getMetadata<CheerioNode>('aonprdTarget');
    if (common === undefined || root === undefined) return NodeOutputBuilder.of('success');

    // meta arg is unused by finalizeCampActivity (marker only)
    const acc = (state.output ?? {}) as unknown as CampActivityOutput;
    const assembled = finalizeCampActivity(common, acc, acc, { __camp_activity_meta_marked: true }, root);
    void target;

    setConceptOutput(state, assembled);

    return NodeOutputBuilder.of('success');
  }
}

export const finalizeCampActivityNode = new FinalizeCampActivityNode();

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
