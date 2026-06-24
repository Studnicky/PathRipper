//
// Kingmaker mass-combat tactic pages (KMWarTactics.aspx) carry army-type tags
// in traits (Infantry/Skirmisher/Cavalry/Siege), a level marker, optional
// prerequisites/requirements/frequency head labels, and prose effect text. This
// Helpers are inlined.
//
// bespoke node-folder under nodes/km-war-tactic/.
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState }    from '../../../src/state/ScrapeState.js';
import type { ConceptDecl } from '../../../src/types/Taxonomy.js';
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
  for (const trait of traits) {
    if (ARMY_TYPE_TAGS.has(trait)) out.push(trait);
  }
  return out;
}

function clean(str: string | null): string | null {
  if (str === null) return null;
  const trimmed = str.trim().replace(/[;,]\s*$/, '').trim();
  return trimmed === '' ? null : trimmed;
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

export function extractKmWarTacticBase(common: CommonExtraction): KmWarTacticBaseSlice {
  return {
    url:             common.url,
    tactic_id:       extractEntityId(common.url),
    name:            common.title.name,
    rarity:          common.traits.rarity,
    traits:          common.traits.traits,
    trait_ids:       common.traits.trait_ids,
    level:           common.title.level,
    army_types:      pickArmyTypes(common.traits.traits),
    source:          { book: common.source.book, page: common.source.page, source_id: common.source.source_id },
    sources:         common.sources,
    pfs:             common.title.pfs,
    legacy:          common.title.legacy,
    alt_edition_url: common.title.alt_edition_url,
  };
}

export function extractKmWarTacticMechanics(common: CommonExtraction): KmWarTacticMechanicsSlice {
  return {
    prerequisites: clean(getField(common, 'Prerequisites', 'Prerequisite')),
    requirements:  clean(getField(common, 'Requirements', 'Requirement')),
    frequency:     clean(getField(common, 'Frequency')),
    effect:        extractEffect(common.body_html),
  };
}

export function extractKmWarTacticMeta(_common: CommonExtraction): KmWarTacticMetaSlice {
  return { __km_war_tactic_meta_marked: true };
}

const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Source',
  'Prerequisites', 'Prerequisite',
  'Requirements', 'Requirement',
  'Frequency',
];

export function finalizeKmWarTactic(
  common: CommonExtraction,
  base:   KmWarTacticBaseSlice,
  mech:   KmWarTacticMechanicsSlice,
  _meta:  KmWarTacticMetaSlice,
  root:   CheerioAPI,
): KmWarTacticOutput {
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
  } satisfies KmWarTacticOutput;
}

export function extractKmWarTactic(common: CommonExtraction, root: CheerioAPI, target: CheerioNode): KmWarTacticOutput {
  void target;
  const base = extractKmWarTacticBase(common);
  const mech = extractKmWarTacticMechanics(common);
  const meta = extractKmWarTacticMeta(common);
  return finalizeKmWarTactic(common, base, mech, meta, root);
}

// Re-export output type so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

export type KmWarTacticBaseOutput = 'success' | 'error';

class KmWarTacticBaseNode extends ScalarNode<ScrapeState, KmWarTacticBaseOutput> {
  public readonly name = 'extract:km-war-tactic-base';
  public readonly outputs = CAPABILITY_OUTPUTS;
  public override get outputSchema(): Record<KmWarTacticBaseOutput, SchemaObjectType> {
    return {
      success: { type: 'object', properties: { output: { type: 'object' } }, required: ['output'] },
      error:   { type: 'object' },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<KmWarTacticBaseOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const base = extractKmWarTacticBase(common);

    state.output = { ...state.output, ...base };

    return NodeOutputBuilder.of('success');
  }
}

export const kmWarTacticBaseNode = new KmWarTacticBaseNode();

// ─────────────────────────────────────────────────────────────────────────────

export type KmWarTacticMechanicsOutput = 'success' | 'error';

class KmWarTacticMechanicsNode extends ScalarNode<ScrapeState, KmWarTacticMechanicsOutput> {
  public readonly name = 'extract:km-war-tactic-mechanics';
  public readonly outputs = CAPABILITY_OUTPUTS;
  public override get outputSchema(): Record<KmWarTacticMechanicsOutput, SchemaObjectType> {
    return {
      success: { type: 'object', properties: { output: { type: 'object' } }, required: ['output'] },
      error:   { type: 'object' },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<KmWarTacticMechanicsOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const mech = extractKmWarTacticMechanics(common);

    state.output = { ...state.output, ...mech };

    return NodeOutputBuilder.of('success');
  }
}

export const kmWarTacticMechanicsNode = new KmWarTacticMechanicsNode();

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeKmWarTacticOutput = 'success';

class FinalizeKmWarTacticNode extends ScalarNode<ScrapeState, FinalizeKmWarTacticOutput> {
  public readonly name = 'finalize:km-war-tactic';
  public readonly outputs = ['success'] as const;
  public override get outputSchema(): Record<FinalizeKmWarTacticOutput, SchemaObjectType> {
    return {
      success: { type: 'object', properties: { output: { type: 'object' } }, required: ['output'] },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<FinalizeKmWarTacticOutput>> {
    const common  = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root    = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target  = state.getMetadata<CheerioNode>('aonprdTarget');
    if (common === undefined || root === undefined) return NodeOutputBuilder.of('success');

    // meta arg is unused by finalizeKmWarTactic (marker only)
    const acc = (state.output ?? {}) as unknown as KmWarTacticOutput;
    const assembled = finalizeKmWarTactic(common, acc, acc, { __km_war_tactic_meta_marked: true }, root);
    void target;

    setConceptOutput(state, assembled);

    return NodeOutputBuilder.of('success');
  }
}

export const finalizeKmWarTacticNode = new FinalizeKmWarTacticNode();

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
