//
// Monster-ability pages are simple definition pages (Trigger / Requirements /
// Frequency / Effect labels plus prose). Adds cross-reference harvest for
// related MonsterAbilities.aspx links.
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
  type PfsLegality,
  type Section,
  type SourceRef,
  type ActionCost,
  htmlToText,
  extractEntityId,
  extractMetaDescription,
  extractMetaKeywords,
  stripStructuredKeys,
} from '../common.js';

// ─── Output type ─────────────────────────────────────────────────────────────

/** Reference to another MonsterAbilities.aspx entry harvested from prose links. */
export interface MonsterAbilityRef {
  /** Display text of the anchor. */
  name:                string;
  /** Numeric AON MonsterAbilities.aspx ID, when the link carries `?ID=`. */
  monster_ability_id:  number | null;
  /** Verbatim href. */
  href:                string;
}

export interface MonsterAbilityOutput {
  url:                string;
  /** Numeric AON MonsterAbilities.aspx ID extracted from the URL query string. */
  monster_ability_id: number | null;
  name:               string;
  rarity:             Rarity;
  pfs:                PfsLegality | null;
  legacy:             boolean;
  alt_edition_url:    string | null;
  /** Action-cost glyph parsed from the title, when present. */
  action_cost:        ActionCost | null;
  traits:             string[];
  trait_ids:          Record<string, number>;
  source:             { book: string | null; page: number | null; source_id: number | null };
  sources:            SourceRef[];

  // ─── Definition labels (from body_html) ───────────────────────────────────
  /** `<b>Trigger</b>` value, when present. */
  trigger:            string | null;
  /** `<b>Requirements</b>` value, when present. */
  requirements:       string | null;
  /** `<b>Frequency</b>` value, when present. */
  frequency:          string | null;
  /** `<b>Effect</b>` value, when present. */
  effect:             string | null;

  // ─── Cross-references ─────────────────────────────────────────────────────
  /** Sibling MonsterAbilities.aspx references harvested from body prose. */
  related_abilities:  MonsterAbilityRef[];

  // ─── Bookkeeping ──────────────────────────────────────────────────────────
  sections:           Section[];
  raw_fields:         Record<string, string>;
  links:              LinkRef[];
  body_text:          string;
  body_html:          string;
  /** `<meta name="description">` content. */
  meta_description:   string | null;
  /** `<meta name="keywords">` content. */
  meta_keywords:      string | null;
}

// ─── Per-node slice types ─────────────────────────────────────────────────────

/** Fields owned by `extract-monster-ability-base`. */
export interface MonsterAbilityBaseSlice {
  url:                string;
  monster_ability_id: number | null;
  name:               string;
  rarity:             Rarity;
  pfs:                PfsLegality | null;
  legacy:             boolean;
  alt_edition_url:    string | null;
  action_cost:        ActionCost | null;
  traits:             string[];
  trait_ids:          Record<string, number>;
  source:             MonsterAbilityOutput['source'];
  sources:            SourceRef[];
}

/** Fields owned by `extract-monster-ability-definition`. */
export interface MonsterAbilityDefinitionSlice {
  trigger:           string | null;
  requirements:      string | null;
  frequency:         string | null;
  effect:            string | null;
  related_abilities: MonsterAbilityRef[];
}

/** Fields owned by `extract-monster-ability-meta`. */
export interface MonsterAbilityMetaSlice {
  /** Marker so `state.output` accumulates the slice. */
  __monster_ability_meta_marked: true;
}

// ─── Label harvesting ────────────────────────────────────────────────────────

/**
 * Harvest `<b>Label</b> Value` pairs from a fragment.
 *
 * Returns a case-insensitive Map keyed by the inner text of the `<b>`, with
 * value capturing all text up to the next `<b>` boundary or end of fragment.
 * `<br>` separators are tolerated by the lookahead.
 */
function harvestBoldLabels(html: string): Map<string, string> {
  const out = new Map<string, string>();
  const regex = /<b>([\s\S]*?)<\/b>([\s\S]*?)(?=<b>|<h[1-6]\b|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const labelHtml = match[1] ?? '';
    const valueHtml = match[2] ?? '';
    const label = htmlToText(labelHtml).replace(/[:?]$/, '').trim();
    if (label === '') continue;
    const value = htmlToText(valueHtml).replace(/^[\s;,:]+|[\s;,]+$/g, '');
    if (value === '') continue;
    const key = label.toLowerCase();
    if (!out.has(key)) out.set(key, value);
  }
  return out;
}

/** Harvest sibling MonsterAbilities.aspx links from the body prose. */
function parseRelatedAbilities(common: CommonExtraction): MonsterAbilityRef[] {
  const out: MonsterAbilityRef[] = [];
  const seen = new Set<string>();
  const selfId = extractEntityId(common.url);
  for (const link of common.links) {
    if (link.kind !== 'MonsterAbilities') continue;
    if (link.text === '' || seen.has(link.href)) continue;
    if (link.id !== null && link.id === selfId) continue;
    seen.add(link.href);
    out.push({ name: link.text, monster_ability_id: link.id, href: link.href });
  }
  return out;
}

// ─── Per-slice extraction helpers ─────────────────────────────────────────────

/** Extract base identity + header scalars for a monster-ability page. */
export function extractMonsterAbilityBase(common: CommonExtraction): MonsterAbilityBaseSlice {
  return {
    url:                common.url,
    monster_ability_id: extractEntityId(common.url),
    name:               common.title.name,
    rarity:             common.traits.rarity,
    pfs:                common.title.pfs,
    legacy:             common.title.legacy,
    alt_edition_url:    common.title.alt_edition_url,
    action_cost:        common.title.action_cost,
    traits:             common.traits.traits,
    trait_ids:          common.traits.trait_ids,
    source:             { book: common.source.book, page: common.source.page, source_id: common.source.source_id },
    sources:            common.sources,
  };
}

/** Extract definition labels (Trigger / Requirements / Frequency / Effect). */
export function extractMonsterAbilityDefinition(common: CommonExtraction): MonsterAbilityDefinitionSlice {
  const map = harvestBoldLabels(common.body_html);
  return {
    trigger:           map.get('trigger')      ?? null,
    requirements:      map.get('requirements') ?? null,
    frequency:         map.get('frequency')    ?? null,
    effect:            map.get('effect')       ?? null,
    related_abilities: parseRelatedAbilities(common),
  };
}

/** Meta marker — body/sections/links/meta attach during finalize. */
export function extractMonsterAbilityMeta(_common: CommonExtraction): MonsterAbilityMetaSlice {
  return { __monster_ability_meta_marked: true };
}

// ─── Finalize ────────────────────────────────────────────────────────────────

/**
 * AON labels claimed by upstream monster-ability slices. Source is stripped by
 * the common harvest, but pre-Remaster pages occasionally surface Trigger /
 * Requirements / Frequency / Effect in `field_map` when an `<hr/>` is present.
 */
const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Source',
  'Trigger', 'Requirements', 'Frequency', 'Effect',
];

export function finalizeMonsterAbility(
  common:     CommonExtraction,
  base:       MonsterAbilityBaseSlice,
  definition: MonsterAbilityDefinitionSlice,
  _meta:      MonsterAbilityMetaSlice,
  root:       CheerioAPI,
  _target:    CheerioNode,
): MonsterAbilityOutput {
  void _meta;
  void _target;
  const raw_fields = stripStructuredKeys(common.field_map, CLAIMED_FIELD_LABELS);
  return {
    ...base,
    ...definition,
    sections:         common.sections,
    raw_fields,
    links:            common.links,
    body_text:        common.body_text,
    body_html:        common.body_html,
    meta_description: extractMetaDescription(root),
    meta_keywords:    extractMetaKeywords(root),
  } satisfies MonsterAbilityOutput;
}

/**
 * Project a MonsterAbilities.aspx page into a typed MonsterAbilityOutput.
 *
 * Thin assembly wrapper kept for `parseAonHtml` direct-call paths and unit
 * tests. The DAG pipeline calls the per-slice helpers individually through
 * the decomposed monster-ability extraction nodes.
 */
export function extractMonsterAbility(
  common: CommonExtraction,
  root:   CheerioAPI,
  target: CheerioNode,
): MonsterAbilityOutput {
  const base       = extractMonsterAbilityBase(common);
  const definition = extractMonsterAbilityDefinition(common);
  const meta       = extractMonsterAbilityMeta(common);
  return finalizeMonsterAbility(common, base, definition, meta, root, target);
}

// Re-export output type so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

export type MonsterAbilityBaseOutput = 'success' | 'error';

class MonsterAbilityBaseNode extends ScalarNode<ScrapeState, MonsterAbilityBaseOutput> {
  public readonly name    = 'extract:monster-ability-base';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<MonsterAbilityBaseOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const base = extractMonsterAbilityBase(common);

    state.output = { ...state.output, ...base };

    return NodeOutputBuilder.of('success');
  }
}

export const monsterAbilityBaseNode = new MonsterAbilityBaseNode();

// ─────────────────────────────────────────────────────────────────────────────

export type MonsterAbilityDefinitionOutput = 'success' | 'error';

class MonsterAbilityDefinitionNode extends ScalarNode<ScrapeState, MonsterAbilityDefinitionOutput> {
  public readonly name    = 'extract:monster-ability-definition';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<MonsterAbilityDefinitionOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const definition = extractMonsterAbilityDefinition(common);

    state.output = { ...state.output, ...definition };

    return NodeOutputBuilder.of('success');
  }
}

export const monsterAbilityDefinitionNode = new MonsterAbilityDefinitionNode();

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeMonsterAbilityOutput = 'success';

class FinalizeMonsterAbilityNode extends ScalarNode<ScrapeState, FinalizeMonsterAbilityOutput> {
  public readonly name    = 'finalize:monster-ability';
  public readonly outputs = ['success'] as const;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<FinalizeMonsterAbilityOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root   = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (common === undefined || root === undefined || target === undefined) return NodeOutputBuilder.of('success');
    const acc = (state.output ?? {}) as unknown as MonsterAbilityOutput;
    const assembled = finalizeMonsterAbility(common, (acc as never), (acc as never), (acc as never), root, target);
    setConceptOutput(state, assembled);

    return NodeOutputBuilder.of('success');
  }
}

export const finalizeMonsterAbilityNode = new FinalizeMonsterAbilityNode();

// ─── ConceptDecl export ───────────────────────────────────────────────────────

export const monsterAbilityConcept: ConceptDecl<MonsterAbilityOutput> = {
  id:       'monster-ability',
  parent:   'entity',
  urlPaths: ['monsterabilities'],
  capabilities: [
    monsterAbilityBaseNode,
    monsterAbilityDefinitionNode,
    finalizeMonsterAbilityNode,
  ],
};
