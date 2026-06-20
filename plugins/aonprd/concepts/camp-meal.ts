//
// Kingmaker Companion Guide camp recipe pages (CampMeals.aspx) carry recipe
// price, ingredients, preparation, favorite_meal head labels, a flavor prose
// description, and degree-of-success outcomes. Helpers are inlined.
//
// bespoke node-folder under nodes/camp-meal/.
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';
import type { OperationContractFragmentType } from '@studnicky/dagonizer/contracts';
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
  getField,
  extractEntityId,
  extractMetaDescription,
  extractMetaKeywords,
  stripStructuredKeys,
} from '../common.js';

/** Camp-meal degree-of-success outcome. */
export interface CampMealOutcome {
  tier: 'critical-success' | 'success' | 'failure' | 'critical-failure';
  text: string;
}

export interface CampMealOutput {
  url:             string;
  meal_id:         number | null;
  name:            string;
  rarity:          Rarity;
  traits:          string[];
  trait_ids:       Record<string, number>;
  /** Meal level — right-floated "Meal N". */
  level:           number | null;
  source:          { book: string | null; page: number | null; source_id: number | null };
  sources:         SourceRef[];
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;

  // Mechanics
  recipe_price:    string | null;
  ingredients:     string | null;
  preparation:     string | null;
  favorite_meal:   string | null;
  description:     string;
  outcomes:        CampMealOutcome[];

  // Bookkeeping
  sections:         Section[];
  raw_fields:       Record<string, string>;
  links:            LinkRef[];
  body_text:        string;
  body_html:        string;
  meta_description: string | null;
  meta_keywords:    string | null;
}

export interface CampMealBaseSlice {
  url:             string;
  meal_id:         number | null;
  name:            string;
  rarity:          Rarity;
  traits:          string[];
  trait_ids:       Record<string, number>;
  level:           number | null;
  source:          CampMealOutput['source'];
  sources:         SourceRef[];
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;
}

export interface CampMealMechanicsSlice {
  recipe_price:  string | null;
  ingredients:   string | null;
  preparation:   string | null;
  favorite_meal: string | null;
  description:   string;
  outcomes:      CampMealOutcome[];
}

export interface CampMealMetaSlice {
  __camp_meal_meta_marked: true;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

const MEAL_OUTCOME_LABELS: ReadonlyArray<{ label: string; tier: CampMealOutcome['tier'] }> = [
  { label: 'Critical Success', tier: 'critical-success' },
  { label: 'Success',          tier: 'success' },
  { label: 'Failure',          tier: 'failure' },
  { label: 'Critical Failure', tier: 'critical-failure' },
];

function parseOutcomes(body: string): CampMealOutcome[] {
  const out: CampMealOutcome[] = [];
  for (const { label, tier } of MEAL_OUTCOME_LABELS) {
    const val = pickOutcomeHtml(body, label);
    if (val === null) continue;
    const text = htmlToText(val);
    if (text === '') continue;
    out.push({ tier, text });
  }
  return out;
}

/** Description is the prose before the first outcome label inside body_html. */
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

export function extractCampMealBase(common: CommonExtraction): CampMealBaseSlice {
  return {
    url:             common.url,
    meal_id:         extractEntityId(common.url),
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

export function extractCampMealMechanics(common: CommonExtraction): CampMealMechanicsSlice {
  return {
    recipe_price:  clean(getField(common, 'Recipe Price')),
    ingredients:   clean(getField(common, 'Ingredients')),
    preparation:   clean(getField(common, 'Preparation')),
    favorite_meal: clean(getField(common, 'Favorite Meal')),
    description:   extractDescription(common.body_html),
    outcomes:      parseOutcomes(common.body_html),
  };
}

export function extractCampMealMeta(_common: CommonExtraction): CampMealMetaSlice {
  return { __camp_meal_meta_marked: true };
}

const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Source',
  'Recipe Price', 'Ingredients', 'Preparation', 'Favorite Meal',
  'Critical Success', 'Success', 'Failure', 'Critical Failure',
  // Inline activate-style labels on consumable meals.
  'Requirements', 'Frequency', 'Effect', 'Trigger', 'Activate',
  'Ignite Magic', 'Careful Casting',
];

export function finalizeCampMeal(
  common: CommonExtraction,
  base:   CampMealBaseSlice,
  mech:   CampMealMechanicsSlice,
  _meta:  CampMealMetaSlice,
  root:   CheerioAPI,
): CampMealOutput {
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
  } satisfies CampMealOutput;
}

export function extractCampMeal(common: CommonExtraction, root: CheerioAPI, target: CheerioNode): CampMealOutput {
  void target;
  const base = extractCampMealBase(common);
  const mech = extractCampMealMechanics(common);
  const meta = extractCampMealMeta(common);
  return finalizeCampMeal(common, base, mech, meta, root);
}

// Re-export output type so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

export type CampMealBaseOutput = 'success' | 'error';

class CampMealBaseNodeImpl extends ScalarNode<ScrapeState, CampMealBaseOutput> {
  public readonly name    = 'extract:camp-meal-base';
  public readonly outputs = CAPABILITY_OUTPUTS;
  public override readonly contract: OperationContractFragmentType = {
    hardRequired: ['aonprdCommon'],
    produces:     [],
  };

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<CampMealBaseOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const base = extractCampMealBase(common);

    state.output = { ...state.output, ...base };

    return NodeOutputBuilder.of('success');
  }
}
export const campMealBaseNode = new CampMealBaseNodeImpl();

// ─────────────────────────────────────────────────────────────────────────────

export type CampMealMechanicsOutput = 'success' | 'error';

class CampMealMechanicsNodeImpl extends ScalarNode<ScrapeState, CampMealMechanicsOutput> {
  public readonly name    = 'extract:camp-meal-mechanics';
  public readonly outputs = CAPABILITY_OUTPUTS;
  public override readonly contract: OperationContractFragmentType = {
    hardRequired: ['aonprdCommon'],
    produces:     [],
  };

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<CampMealMechanicsOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const mech = extractCampMealMechanics(common);

    state.output = { ...state.output, ...mech };

    return NodeOutputBuilder.of('success');
  }
}
export const campMealMechanicsNode = new CampMealMechanicsNodeImpl();

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeCampMealOutput = 'success';

class FinalizeCampMealNodeImpl extends ScalarNode<ScrapeState, FinalizeCampMealOutput> {
  public readonly name    = 'finalize:camp-meal';
  public readonly outputs = ['success'] as const;
  public override readonly contract: OperationContractFragmentType = {
    hardRequired: ['aonprdCommon', 'aonprdCheerio'],
    produces:     [],
  };

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<FinalizeCampMealOutput>> {
    const common  = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root    = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target  = state.getMetadata<CheerioNode>('aonprdTarget');
    if (common === undefined || root === undefined) return NodeOutputBuilder.of('success');

    // meta arg is unused by finalizeCampMeal (marker only)
    const acc = (state.output ?? {}) as unknown as CampMealOutput;
    const assembled = finalizeCampMeal(common, acc, acc, { __camp_meal_meta_marked: true }, root);
    void target;

    setConceptOutput(state, assembled);

    return NodeOutputBuilder.of('success');
  }
}
export const finalizeCampMealNode = new FinalizeCampMealNodeImpl();

// ─── ConceptDecl export ───────────────────────────────────────────────────────

export const campMealConcept: ConceptDecl<CampMealOutput> = {
  id:       'camp-meal',
  parent:   'entity',
  urlPaths: ['campmeals'],
  capabilities: [
    campMealBaseNode,
    campMealMechanicsNode,
    finalizeCampMealNode,
  ],
};
