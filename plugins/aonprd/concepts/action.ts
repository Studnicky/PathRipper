//
// Byte-equivalent to Wave 5 shape — action pages are well-structured;
// the Wave 5 helpers already handle all significant data including skill refs,
// four-tier outcome blocks, and trigger/frequency/requirements fields.
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
  type ActionCost,
  type LinkRef,
  type Rarity,
  type SourceRef,
  getField,
  getFieldHtml,
  htmlToText,
  extractEntityId,
  extractMetaDescription,
  extractMetaKeywords,
  stripStructuredKeys,
} from '../common.js';
import { parseOutcomesBlock } from '../capabilities/outcomesBlock.js';

// ─── Inlined from Wave 5: action.ts ──────────────────────────────────
// ─── Output shape ─────────────────────────────────────────────────────────────

export interface ActionOutput {
  url: string;
  /** Numeric AON ID extracted from the URL query string. */
  action_id: number | null;
  name: string;
  rarity: Rarity;
  action_cost: ActionCost | null;
  traits: string[];
  /** Trait AON IDs keyed by trait name. */
  trait_ids: Record<string, number>;
  source: { book: string | null; page: number | null; source_id: number | null };
  /** All source refs on the page (header + body footnotes). */
  sources: SourceRef[];
  legacy: boolean;
  alt_edition_url: string | null;
  trigger: string | null;
  frequency: string | null;
  requirements: string | null;
  cost: string | null;
  /**
   * Skill required to use this action, from the `<b>Skill</b>` field.
   * Present on ~105 of 420 actions (kingdom actions, skill actions).
   * Includes the proficiency tier in parentheses (e.g. "Acrobatics (Trained)").
   */
  skill: { name: string; skill_id: number | null; proficiency: string | null } | null;
  effect_html: string;
  effect_text: string;
  outcomes: {
    critical_success: string | null;
    success: string | null;
    failure: string | null;
    critical_failure: string | null;
  };
  raw_fields: Record<string, string>;
  links: LinkRef[];
  /** `<meta name="description">` content. */
  meta_description: string | null;
  /** `<meta name="keywords">` content. */
  meta_keywords: string | null;
}

// ─── Per-node slice types ─────────────────────────────────────────────────────

/** Fields owned by `extract-action-base`. */
export interface ActionBaseSlice {
  url:             string;
  action_id:       number | null;
  name:            string;
  rarity:          Rarity;
  action_cost:     ActionCost | null;
  traits:          string[];
  trait_ids:       Record<string, number>;
  source:          ActionOutput['source'];
  sources:         SourceRef[];
  legacy:          boolean;
  alt_edition_url: string | null;
}

/** Fields owned by `extract-action-effect`. */
export interface ActionEffectSlice {
  trigger:      string | null;
  frequency:    string | null;
  requirements: string | null;
  cost:         string | null;
  effect_html:  string;
  effect_text:  string;
  outcomes:     ActionOutput['outcomes'];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DASH_RE = /^(?:—|–|-|&mdash;|&ndash;)$/;

function dashToNull(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed === '' || DASH_RE.test(trimmed)) return null;
  return trimmed;
}

/**
 * Parse outcomes from the effect HTML.
 */
function parseOutcomes(bodyHtml: string): ActionOutput['outcomes'] {
  return parseOutcomesBlock(bodyHtml);
}

/** Build effect prose, stripping the outcome markers we already projected. */
function buildEffect(bodyHtml: string): { html: string; text: string } {
  // Cap at first `<h2>` subsection or `<hr />`.
  const subIdx = /<h2\s+class="title"/i.exec(bodyHtml);
  const before = subIdx === null ? bodyHtml : bodyHtml.slice(0, subIdx.index);
  return { html: before.trim(), text: htmlToText(before) };
}

/**
 * Parse the `<b>Skill</b>` header field into a structured skill ref.
 * The raw text is typically "SkillName (Proficiency)" — e.g. "Acrobatics (Trained)".
 * The Skills.aspx link provides the skill_id.
 */
function parseSkill(c: CommonExtraction): ActionOutput['skill'] {
  const html = getFieldHtml(c, 'Skill');
  if (html === null) return null;
  // Extract Skills.aspx link
  const anchorRe = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i;
  const m = anchorRe.exec(html);
  const rawText = htmlToText(html).trim();
  if (rawText === '') return null;

  let skill_id: number | null = null;
  if (m !== null) {
    const idMatch = /\?ID=(\d+)/i.exec(m[1] ?? '');
    skill_id = idMatch !== null ? parseInt(idMatch[1]!, 10) : null;
  }

  // Text format: "SkillName (Proficiency)" — extract the proficiency from parens.
  const profMatch = /^(.+?)\s+\((\w+)\)$/.exec(rawText);
  if (profMatch !== null) {
    return {
      name:        (profMatch[1] ?? rawText).trim(),
      skill_id,
      proficiency: (profMatch[2] ?? null),
    };
  }
  return { name: rawText, skill_id, proficiency: null };
}

// ─── Per-slice extraction helpers ─────────────────────────────────────────────

/** Extract base identity slice (URL, traits, rarity, action cost, sources, legacy). */
export function extractActionBase(c: CommonExtraction): ActionBaseSlice {
  return {
    url:             c.url,
    action_id:       extractEntityId(c.url),
    name:            c.title.name,
    rarity:          c.traits.rarity,
    action_cost:     c.title.action_cost,
    traits:          c.traits.traits,
    trait_ids:       c.traits.trait_ids,
    source:          { book: c.source.book, page: c.source.page, source_id: c.source.source_id },
    sources:         c.sources,
    legacy:          c.title.legacy,
    alt_edition_url: c.title.alt_edition_url,
  };
}

/**
 * Extract effect slice (header fields Trigger/Frequency/Requirements/Cost,
 * effect prose, and four-tier outcome block).
 */
export function extractActionEffect(c: CommonExtraction): ActionEffectSlice {
  const effect = buildEffect(c.body_html);
  return {
    trigger:      dashToNull(getField(c, 'Trigger')),
    frequency:    dashToNull(getField(c, 'Frequency')),
    requirements: dashToNull(getField(c, 'Requirements')),
    cost:         dashToNull(getField(c, 'Cost')),
    effect_html:  effect.html,
    effect_text:  effect.text,
    outcomes:     parseOutcomes(c.body_html),
  };
}

/** AON labels every per-slice helper has lifted into structured fields. */
const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  // Base slice — source ref is already structured.
  'Source',
  // Effect slice
  'Trigger', 'Frequency', 'Requirements', 'Cost', 'Effect',
  // Outcome markers
  'Critical Success', 'Success', 'Failure', 'Critical Failure',
  // Finalize slice
  'Skill',
];

/**
 * Assemble the final ActionOutput from per-slice results.
 *
 * Owns the Skill field (parsed here as the single non-effect meta concern) and
 * computes `raw_fields` by stripping every label claimed by upstream slices.
 */
export function finalizeAction(
  c:      CommonExtraction,
  base:   ActionBaseSlice,
  effect: ActionEffectSlice,
  $:      CheerioAPI,
): ActionOutput {
  const skill = parseSkill(c);
  return {
    ...base,
    ...effect,
    skill,
    raw_fields:       stripStructuredKeys(c.field_map, CLAIMED_FIELD_LABELS),
    links:            c.links,
    meta_description: extractMetaDescription($),
    meta_keywords:    extractMetaKeywords($),
  } satisfies ActionOutput;
}

// ─── Public extractor ─────────────────────────────────────────────────────────

/**
 * Project a CommonExtraction of an Actions.aspx page into a typed ActionOutput.
 *
 * Thin assembly wrapper kept for `parseAonHtml` direct-call paths and unit
 * tests. The DAG pipeline calls the per-slice helpers individually through
 * the decomposed action extraction nodes.
 */
export function extractAction(c: CommonExtraction, $: CheerioAPI, span: CheerioNode): ActionOutput {
  void span;
  const base   = extractActionBase(c);
  const effect = extractActionEffect(c);
  return finalizeAction(c, base, effect, $);
}

// Re-export output type so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

export type ActionBaseOutput = 'success' | 'error';

export const actionBaseNode: NodeInterface<ScrapeState, ActionBaseOutput, RipperServices> = {
  name:    'extract:action-base',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: ActionBaseOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const base = extractActionBase(c);

    state.output = { ...state.output, ...base };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type ActionEffectOutput = 'success' | 'error';

export const actionEffectNode: NodeInterface<ScrapeState, ActionEffectOutput, RipperServices> = {
  name:    'extract:action-effect',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: ActionEffectOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const effect = extractActionEffect(c);

    state.output = { ...state.output, ...effect };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeActionOutput = 'success';

export const finalizeActionNode: NodeInterface<ScrapeState, FinalizeActionOutput, RipperServices> = {
  name:    'finalize:action',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FinalizeActionOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $ = state.getMetadata<CheerioAPI>('aonprdCheerio');
    if (c === undefined || $ === undefined) return { output: 'success' };
    const acc = (state.output ?? {}) as unknown as ActionOutput;
    const assembled = finalizeAction(c, acc, acc, $);
    setConceptOutput(state, assembled);

    return { output: 'success' };
  },
};

// ─── ConceptDecl export ───────────────────────────────────────────────────────

export const actionConcept: ConceptDecl<ActionOutput> = {
  id:       'action',
  parent:   'entity',
  urlPaths: ['actions', 'activities'],
  capabilities: [
    actionBaseNode,
    actionEffectNode,
    finalizeActionNode,
  ],
};
