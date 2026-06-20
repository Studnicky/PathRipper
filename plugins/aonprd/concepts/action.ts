//
// Action pages are well-structured; the inlined helpers handle all significant
// data including skill refs, four-tier outcome blocks, and
// trigger/frequency/requirements fields.
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
function parseSkill(common: CommonExtraction): ActionOutput['skill'] {
  const html = getFieldHtml(common, 'Skill');
  if (html === null) return null;
  // Extract Skills.aspx link
  const anchorRe = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i;
  const match = anchorRe.exec(html);
  const rawText = htmlToText(html).trim();
  if (rawText === '') return null;

  let skill_id: number | null = null;
  if (match !== null) {
    const idMatch = /\?ID=(\d+)/i.exec(match[1] ?? '');
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
export function extractActionBase(common: CommonExtraction): ActionBaseSlice {
  return {
    url:             common.url,
    action_id:       extractEntityId(common.url),
    name:            common.title.name,
    rarity:          common.traits.rarity,
    action_cost:     common.title.action_cost,
    traits:          common.traits.traits,
    trait_ids:       common.traits.trait_ids,
    source:          { book: common.source.book, page: common.source.page, source_id: common.source.source_id },
    sources:         common.sources,
    legacy:          common.title.legacy,
    alt_edition_url: common.title.alt_edition_url,
  };
}

/**
 * Extract effect slice (header fields Trigger/Frequency/Requirements/Cost,
 * effect prose, and four-tier outcome block).
 */
export function extractActionEffect(common: CommonExtraction): ActionEffectSlice {
  const effect = buildEffect(common.body_html);
  return {
    trigger:      dashToNull(getField(common, 'Trigger')),
    frequency:    dashToNull(getField(common, 'Frequency')),
    requirements: dashToNull(getField(common, 'Requirements')),
    cost:         dashToNull(getField(common, 'Cost')),
    effect_html:  effect.html,
    effect_text:  effect.text,
    outcomes:     parseOutcomes(common.body_html),
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
  common:  CommonExtraction,
  base:    ActionBaseSlice,
  effect:  ActionEffectSlice,
  root:    CheerioAPI,
): ActionOutput {
  const skill = parseSkill(common);
  return {
    ...base,
    ...effect,
    skill,
    raw_fields:       stripStructuredKeys(common.field_map, CLAIMED_FIELD_LABELS),
    links:            common.links,
    meta_description: extractMetaDescription(root),
    meta_keywords:    extractMetaKeywords(root),
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
export function extractAction(common: CommonExtraction, root: CheerioAPI, span: CheerioNode): ActionOutput {
  void span;
  const base   = extractActionBase(common);
  const effect = extractActionEffect(common);
  return finalizeAction(common, base, effect, root);
}

// Re-export output type so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

export type ActionBaseOutput = 'success' | 'error';

class ActionBaseNodeImpl extends ScalarNode<ScrapeState, ActionBaseOutput> {
  public readonly name = 'extract:action-base';
  public readonly outputs = CAPABILITY_OUTPUTS;
  public override readonly contract: OperationContractFragmentType = {
    hardRequired: ['aonprdCommon'],
    produces:     [],
  };

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<ActionBaseOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const base = extractActionBase(common);

    state.output = { ...state.output, ...base };

    return NodeOutputBuilder.of('success');
  }
}
export const actionBaseNode = new ActionBaseNodeImpl();

// ─────────────────────────────────────────────────────────────────────────────

export type ActionEffectOutput = 'success' | 'error';

class ActionEffectNodeImpl extends ScalarNode<ScrapeState, ActionEffectOutput> {
  public readonly name = 'extract:action-effect';
  public readonly outputs = CAPABILITY_OUTPUTS;
  public override readonly contract: OperationContractFragmentType = {
    hardRequired: ['aonprdCommon'],
    produces:     [],
  };

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<ActionEffectOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const effect = extractActionEffect(common);

    state.output = { ...state.output, ...effect };

    return NodeOutputBuilder.of('success');
  }
}
export const actionEffectNode = new ActionEffectNodeImpl();

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeActionOutput = 'success';

class FinalizeActionNodeImpl extends ScalarNode<ScrapeState, FinalizeActionOutput> {
  public readonly name = 'finalize:action';
  public readonly outputs = ['success'] as const;
  public override readonly contract: OperationContractFragmentType = {
    hardRequired: ['aonprdCommon', 'aonprdCheerio'],
    produces:     [],
  };

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<FinalizeActionOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root   = state.getMetadata<CheerioAPI>('aonprdCheerio');
    if (common === undefined || root === undefined) return NodeOutputBuilder.of('success');
    const acc = (state.output ?? {}) as unknown as ActionOutput;
    const assembled = finalizeAction(common, acc, acc, root);
    setConceptOutput(state, assembled);

    return NodeOutputBuilder.of('success');
  }
}
export const finalizeActionNode = new FinalizeActionNodeImpl();

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
