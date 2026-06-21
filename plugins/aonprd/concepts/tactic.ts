//
// Commander class squad-tactic pages (Tactics.aspx) carry an action-cost glyph,
// a category/tier marker, optional prerequisites/requirements/trigger/frequency
// head labels, an effect body, and an optional Special callout. This concept
// Output is
// bespoke node-folder under nodes/tactic/.
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
  const match = labelRe.exec(body);
  if (match === null) return null;
  const start    = match.index + match[0].length;
  const rest     = body.slice(start);
  const boundary = /<b>|<br\s*\/?>|<\/span>|<h[23]\s+class="title"/i.exec(rest);
  const end      = boundary !== null ? boundary.index : rest.length;
  const value    = rest.slice(0, end).trim();
  if (value === '') return null;
  return value;
}

function clean(str: string | null): string | null {
  if (str === null) return null;
  const trimmed = str.replace(/[;,]\s*$/, '').trim();
  return trimmed === '' ? null : trimmed;
}

// ─── Per-slice extraction helpers ─────────────────────────────────────────────

export function extractTacticBase(common: CommonExtraction): TacticBaseSlice {
  // Tactics' right-floated marker is the proficiency tier or category — not a
  // level. level_label captures the marker prefix word.
  return {
    url:             common.url,
    tactic_id:       extractEntityId(common.url),
    name:            common.title.name,
    rarity:          common.traits.rarity,
    traits:          common.traits.traits,
    trait_ids:       common.traits.trait_ids,
    action_cost:     common.title.action_cost,
    category:        common.title.level_label,
    source:          { book: common.source.book, page: common.source.page, source_id: common.source.source_id },
    sources:         common.sources,
    pfs:             common.title.pfs,
    legacy:          common.title.legacy,
    alt_edition_url: common.title.alt_edition_url,
  };
}

export function extractTacticMechanics(common: CommonExtraction): TacticMechanicsSlice {
  // Head labels: Prerequisites/Requirements/Trigger/Frequency live in fields
  // (head, before <hr/>) — read via the canonical field_map first, fall back
  // to value scanning if absent.
  const fromField = (key: string): string | null => clean(getField(common, key));

  // Effect is the post-<hr/> body, minus a trailing `<b>Special</b>` block.
  const body    = common.body_html;
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

export function extractTacticMeta(_common: CommonExtraction): TacticMetaSlice {
  return { __tactic_meta_marked: true };
}

const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Source',
  'Prerequisites', 'Prerequisite',
  'Requirements', 'Requirement',
  'Trigger', 'Frequency',
];

export function finalizeTactic(
  common: CommonExtraction,
  base:   TacticBaseSlice,
  mech:   TacticMechanicsSlice,
  _meta:  TacticMetaSlice,
  root:   CheerioAPI,
): TacticOutput {
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
  } satisfies TacticOutput;
}

export function extractTactic(common: CommonExtraction, root: CheerioAPI, target: CheerioNode): TacticOutput {
  void target;
  const base = extractTacticBase(common);
  const mech = extractTacticMechanics(common);
  const meta = extractTacticMeta(common);
  return finalizeTactic(common, base, mech, meta, root);
}

// Re-export output type so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

export type TacticBaseOutput = 'success' | 'error';

class TacticBaseNodeImpl extends ScalarNode<ScrapeState, TacticBaseOutput> {
  public readonly name    = 'extract:tactic-base';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<TacticBaseOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const base = extractTacticBase(common);

    state.output = { ...state.output, ...base };

    return NodeOutputBuilder.of('success');
  }
}
export const tacticBaseNode = new TacticBaseNodeImpl();

// ─────────────────────────────────────────────────────────────────────────────

export type TacticMechanicsOutput = 'success' | 'error';

class TacticMechanicsNodeImpl extends ScalarNode<ScrapeState, TacticMechanicsOutput> {
  public readonly name    = 'extract:tactic-mechanics';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<TacticMechanicsOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const mech = extractTacticMechanics(common);

    state.output = { ...state.output, ...mech };

    return NodeOutputBuilder.of('success');
  }
}
export const tacticMechanicsNode = new TacticMechanicsNodeImpl();

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeTacticOutput = 'success';

class FinalizeTacticNodeImpl extends ScalarNode<ScrapeState, FinalizeTacticOutput> {
  public readonly name    = 'finalize:tactic';
  public readonly outputs = ['success'] as const;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<FinalizeTacticOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root   = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (common === undefined || root === undefined) return NodeOutputBuilder.of('success');

    // meta arg is unused by finalizeTactic (marker only)
    const acc = (state.output ?? {}) as unknown as TacticOutput;
    const assembled = finalizeTactic(common, acc, acc, { __tactic_meta_marked: true }, root);
    void target;

    setConceptOutput(state, assembled);

    return NodeOutputBuilder.of('success');
  }
}
export const finalizeTacticNode = new FinalizeTacticNodeImpl();

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
