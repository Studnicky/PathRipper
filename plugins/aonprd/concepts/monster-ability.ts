//
// Byte-equivalent to Wave 5 shape — monster-ability pages are simple definition
// pages (Trigger / Requirements / Frequency / Effect labels plus prose) that
// the Wave 5 helpers already fully cover. Adds cross-reference harvest for
// related MonsterAbilities.aspx links.
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

// ─── Inlined from Wave 5: monster-ability.ts ──────────────────────────────────
// ─── Output type ──────────────────────────────────────────────────────────────

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
  const re = /<b>([\s\S]*?)<\/b>([\s\S]*?)(?=<b>|<h[1-6]\b|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const labelHtml = m[1] ?? '';
    const valueHtml = m[2] ?? '';
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
function parseRelatedAbilities(c: CommonExtraction): MonsterAbilityRef[] {
  const out: MonsterAbilityRef[] = [];
  const seen = new Set<string>();
  const selfId = extractEntityId(c.url);
  for (const link of c.links) {
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
export function extractMonsterAbilityBase(c: CommonExtraction): MonsterAbilityBaseSlice {
  return {
    url:                c.url,
    monster_ability_id: extractEntityId(c.url),
    name:               c.title.name,
    rarity:             c.traits.rarity,
    pfs:                c.title.pfs,
    legacy:             c.title.legacy,
    alt_edition_url:    c.title.alt_edition_url,
    action_cost:        c.title.action_cost,
    traits:             c.traits.traits,
    trait_ids:          c.traits.trait_ids,
    source:             { book: c.source.book, page: c.source.page, source_id: c.source.source_id },
    sources:            c.sources,
  };
}

/** Extract definition labels (Trigger / Requirements / Frequency / Effect). */
export function extractMonsterAbilityDefinition(c: CommonExtraction): MonsterAbilityDefinitionSlice {
  const map = harvestBoldLabels(c.body_html);
  return {
    trigger:           map.get('trigger')      ?? null,
    requirements:      map.get('requirements') ?? null,
    frequency:         map.get('frequency')    ?? null,
    effect:            map.get('effect')       ?? null,
    related_abilities: parseRelatedAbilities(c),
  };
}

/** Meta marker — body/sections/links/meta attach during finalize. */
export function extractMonsterAbilityMeta(_c: CommonExtraction): MonsterAbilityMetaSlice {
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
  c:          CommonExtraction,
  base:       MonsterAbilityBaseSlice,
  definition: MonsterAbilityDefinitionSlice,
  _meta:      MonsterAbilityMetaSlice,
  $:          CheerioAPI,
  _target:    CheerioNode,
): MonsterAbilityOutput {
  void _meta;
  void _target;
  const raw_fields = stripStructuredKeys(c.field_map, CLAIMED_FIELD_LABELS);
  return {
    ...base,
    ...definition,
    sections:         c.sections,
    raw_fields,
    links:            c.links,
    body_text:        c.body_text,
    body_html:        c.body_html,
    meta_description: extractMetaDescription($),
    meta_keywords:    extractMetaKeywords($),
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
  c:      CommonExtraction,
  $:      CheerioAPI,
  target: CheerioNode,
): MonsterAbilityOutput {
  const base       = extractMonsterAbilityBase(c);
  const definition = extractMonsterAbilityDefinition(c);
  const meta       = extractMonsterAbilityMeta(c);
  return finalizeMonsterAbility(c, base, definition, meta, $, target);
}

// Re-export output type so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

export type MonsterAbilityBaseOutput = 'success' | 'error';

export const monsterAbilityBaseNode: NodeInterface<ScrapeState, MonsterAbilityBaseOutput, RipperServices> = {
  name:    'extract:monster-ability-base',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: MonsterAbilityBaseOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const base = extractMonsterAbilityBase(c);

    state.output = { ...state.output, ...base };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type MonsterAbilityDefinitionOutput = 'success' | 'error';

export const monsterAbilityDefinitionNode: NodeInterface<ScrapeState, MonsterAbilityDefinitionOutput, RipperServices> = {
  name:    'extract:monster-ability-definition',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: MonsterAbilityDefinitionOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const definition = extractMonsterAbilityDefinition(c);

    state.output = { ...state.output, ...definition };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeMonsterAbilityOutput = 'success';

export const finalizeMonsterAbilityNode: NodeInterface<ScrapeState, FinalizeMonsterAbilityOutput, RipperServices> = {
  name:    'finalize:monster-ability',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'aonprdTarget'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FinalizeMonsterAbilityOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined || target === undefined) return { output: 'success' };
    const acc = (state.output ?? {}) as unknown as MonsterAbilityOutput;
    const assembled = finalizeMonsterAbility(c, (acc as never), (acc as never), (acc as never), $, target);
    setConceptOutput(state, assembled);

    return { output: 'success' };
  },
};

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
