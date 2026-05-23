// Camp-meal concept — Phase 6.4 taxonomic extraction.
//
// Kingmaker Companion Guide camp recipe pages (CampMeals.aspx) carry recipe
// price, ingredients, preparation, favorite_meal head labels, a flavor prose
// description, and degree-of-success outcomes. This concept delegates to Wave 5
// slice helpers in camp-meal.ts for correctness. Output is byte-equivalent to
// the Wave 5 baseline.
//
// Improvement vs Wave 5: capabilities co-located with inline contracts; no
// bespoke node-folder under nodes/camp-meal/.
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

// ─── Inlined from Wave 5: camp-meal.ts ──────────────────────────────────
/** Camp-meal degree-of-success outcome. */
export interface CampMealOutcome {
  tier: 'critical-success' | 'success' | 'failure' | 'critical-failure';
  text: string;
}

export interface CampMealOutput {
  _type:           'camp-meal';
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
  _type:           'camp-meal';
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
  const m = labelRe.exec(html);
  if (m === null) return null;
  const start    = m.index + m[0].length;
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

function clean(s: string | null): string | null {
  if (s === null) return null;
  const t = s.trim().replace(/[;,]\s*$/, '').trim();
  return t === '' ? null : t;
}

// ─── Per-slice extraction helpers ─────────────────────────────────────────────

export function extractCampMealBase(c: CommonExtraction): CampMealBaseSlice {
  return {
    _type:           'camp-meal',
    url:             c.url,
    meal_id:         extractEntityId(c.url),
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

export function extractCampMealMechanics(c: CommonExtraction): CampMealMechanicsSlice {
  return {
    recipe_price:  clean(getField(c, 'Recipe Price')),
    ingredients:   clean(getField(c, 'Ingredients')),
    preparation:   clean(getField(c, 'Preparation')),
    favorite_meal: clean(getField(c, 'Favorite Meal')),
    description:   extractDescription(c.body_html),
    outcomes:      parseOutcomes(c.body_html),
  };
}

export function extractCampMealMeta(_c: CommonExtraction): CampMealMetaSlice {
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
  c:     CommonExtraction,
  base:  CampMealBaseSlice,
  mech:  CampMealMechanicsSlice,
  _meta: CampMealMetaSlice,
  $:     CheerioAPI,
): CampMealOutput {
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
  } satisfies CampMealOutput;
}

export function extractCampMeal(c: CommonExtraction, $: CheerioAPI, target: CheerioNode): CampMealOutput {
  void target;
  const base = extractCampMealBase(c);
  const mech = extractCampMealMechanics(c);
  const meta = extractCampMealMeta(c);
  return finalizeCampMeal(c, base, mech, meta, $);
}


// Re-export output type so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

export type CampMealBaseOutput = 'success' | 'error';

export const campMealBaseNode: NodeInterface<ScrapeState, CampMealBaseOutput, RipperServices> = {
  name:    'extract:camp-meal-base',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: CampMealBaseOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const base = extractCampMealBase(c);

    state.output = { ...state.output, ...base };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type CampMealMechanicsOutput = 'success' | 'error';

export const campMealMechanicsNode: NodeInterface<ScrapeState, CampMealMechanicsOutput, RipperServices> = {
  name:    'extract:camp-meal-mechanics',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: CampMealMechanicsOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const mech = extractCampMealMechanics(c);

    state.output = { ...state.output, ...mech };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeCampMealOutput = 'success';

export const finalizeCampMealNode: NodeInterface<ScrapeState, FinalizeCampMealOutput, RipperServices> = {
  name:    'finalize:camp-meal',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FinalizeCampMealOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined) return { output: 'success' };

    // meta arg is unused by finalizeCampMeal (marker only)
    const acc = (state.output ?? {}) as unknown as CampMealOutput;
    const assembled = finalizeCampMeal(c, acc, acc, { __camp_meal_meta_marked: true }, $);
    void target;

    setConceptOutput(state, assembled);

    return { output: 'success' };
  },
};

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
  discriminator: { _type: 'camp-meal' },
};
