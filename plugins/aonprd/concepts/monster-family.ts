//
// Monster-family pages are lore + member-list pages with minimal structured
// data; the inlined helpers handle the Members framing section harvest and
// family identity.
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';
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
  htmlToText,
  extractEntityId,
  extractMetaDescription,
  extractMetaKeywords,
  stripStructuredKeys,
} from '../common.js';

// ─── Output type ─────────────────────────────────────────────────────────────

/** A creature that belongs to this monster family. */
export interface MonsterFamilyMember {
  /** Creature name as displayed (e.g. "Giant Spider"). */
  name:       string;
  /** AON Monsters.aspx or NPCs.aspx ID, when the link contains `?ID=`. */
  monster_id: number | null;
  /** Target page kind ("Monsters", "NPCs", …). */
  kind:       string;
}

export interface MonsterFamilyOutput {
  url:              string;
  monster_family_id:        number | null;
  name:             string;
  rarity:           Rarity;
  pfs:              PfsLegality | null;
  legacy:           boolean;
  alt_edition_url:  string | null;
  traits:           string[];
  trait_ids:        Record<string, number>;
  source:           { book: string | null; page: number | null; source_id: number | null };
  sources:          SourceRef[];
  sections:         Section[];
  raw_fields:       Record<string, string>;
  links:            LinkRef[];
  body_text:        string;
  body_html:        string;
  /** Creature members listed under the `Members` framing section. */
  members:          MonsterFamilyMember[];
  meta_description: string | null;
  meta_keywords:    string | null;
}

// ─── Per-node slice types ─────────────────────────────────────────────────────

/** Fields owned by `extract-monster-family-base`. */
export interface MonsterFamilyBaseSlice {
  url:             string;
  monster_family_id:       number | null;
  name:            string;
  rarity:          Rarity;
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;
  traits:          string[];
  trait_ids:       Record<string, number>;
  source:          MonsterFamilyOutput['source'];
  sources:         SourceRef[];
}

/** Fields owned by `extract-monster-family-members`. */
export interface MonsterFamilyMembersSlice {
  members: MonsterFamilyMember[];
}

// ─── Member extraction ────────────────────────────────────────────────────────

/**
 * Harvest the `<h3 class="framing">Members</h3>` anchor list.
 * AON renders each member as an anchor inside an inline list; some pages use
 * a simple comma-separated anchor run rather than a formal list element.
 */
function parseMembers(html: string): MonsterFamilyMember[] {
  // Find the Members framing heading.
  const framingRe = /<h3[^>]+class="framing"[^>]*>\s*Members?\s*<\/h3>([\s\S]*?)(?=<h[123]|$)/i;
  const framingMatch = framingRe.exec(html);
  if (framingMatch === null) return [];

  const fragment = framingMatch[1] ?? '';
  const out: MonsterFamilyMember[] = [];
  const seen = new Set<string>();

  const anchorRe = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorRe.exec(fragment)) !== null) {
    const href   = match[1] ?? '';
    const inner  = match[2] ?? '';
    const name   = htmlToText(inner);
    if (name === '' || seen.has(href)) continue;
    seen.add(href);

    // Derive kind from the .aspx filename.
    const kindMatch = /([A-Za-z][A-Za-z0-9]*)\.aspx/i.exec(href);
    const kind      = kindMatch !== null ? kindMatch[1]! : 'unknown';

    const idMatch   = /\?ID=(\d+)/i.exec(href);
    const monster_id = idMatch !== null ? parseInt(idMatch[1]!, 10) : null;

    out.push({ name, monster_id, kind });
  }
  return out;
}

// ─── Per-slice extraction helpers ─────────────────────────────────────────────

/** Extract base identity + header scalars for a monster-family page. */
export function extractMonsterFamilyBase(common: CommonExtraction): MonsterFamilyBaseSlice {
  return {
    url:             common.url,
    monster_family_id:       extractEntityId(common.url),
    name:            common.title.name,
    rarity:          common.traits.rarity,
    pfs:             common.title.pfs,
    legacy:          common.title.legacy,
    alt_edition_url: common.title.alt_edition_url,
    traits:          common.traits.traits,
    trait_ids:       common.traits.trait_ids,
    source:          { book: common.source.book, page: common.source.page, source_id: common.source.source_id },
    sources:         common.sources,
  };
}

/** Extract the member-creature list from the `Members` framing section. */
export function extractMonsterFamilyMembers(common: CommonExtraction): MonsterFamilyMembersSlice {
  return { members: parseMembers(common.body_html) };
}

/**
 * AON labels claimed by upstream monster-family slices. Monster-family pages
 * carry only the standard `Source` header field; everything else (rarity, PFS,
 * legacy, traits) is harvested from the title/trait inventories rather than the
 * field map. The strip list stays minimal so any unexpected residue surfaces
 * cleanly in `raw_fields`.
 */
const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Source',
];

/**
 * Assemble the final MonsterFamilyOutput from per-slice results. Computes
 * `raw_fields` by stripping CLAIMED_FIELD_LABELS and attaches body / link /
 * meta fields owned by the full page.
 */
export function finalizeMonsterFamily(
  common:  CommonExtraction,
  base:    MonsterFamilyBaseSlice,
  members: MonsterFamilyMembersSlice,
  root:    CheerioAPI,
): MonsterFamilyOutput {
  const raw_fields = stripStructuredKeys(common.field_map, CLAIMED_FIELD_LABELS);
  return {
    ...base,
    sections:         common.sections,
    raw_fields,
    links:            common.links,
    body_text:        common.body_text,
    body_html:        common.body_html,
    members:          members.members,
    meta_description: extractMetaDescription(root),
    meta_keywords:    extractMetaKeywords(root),
  } satisfies MonsterFamilyOutput;
}

/**
 * Project a MonsterFamilies.aspx page into a typed MonsterFamilyOutput.
 *
 * Thin assembly wrapper kept for `parseAonHtml` direct-call paths and unit
 * tests. The DAG pipeline calls the per-slice helpers individually through
 * the decomposed monster-family extraction nodes.
 */
export function extractMonsterFamily(
  common: CommonExtraction,
  root:   CheerioAPI,
  _span:  CheerioNode,
): MonsterFamilyOutput {
  void _span;
  const base    = extractMonsterFamilyBase(common);
  const members = extractMonsterFamilyMembers(common);
  return finalizeMonsterFamily(common, base, members, root);
}

// Re-export output type so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

export type MonsterFamilyBaseOutput = 'success' | 'error';

class MonsterFamilyBaseNode extends ScalarNode<ScrapeState, MonsterFamilyBaseOutput> {
  public readonly name = 'extract:monster-family-base';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<MonsterFamilyBaseOutput, SchemaObjectType> {
    return {
      success: { type: 'object', properties: { output: { type: 'object' } }, required: ['output'] },
      error:   { type: 'object' },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<MonsterFamilyBaseOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const base = extractMonsterFamilyBase(common);

    state.output = { ...state.output, ...base };

    return NodeOutputBuilder.of('success');
  }
}

export const monsterFamilyBaseNode = new MonsterFamilyBaseNode();

// ─────────────────────────────────────────────────────────────────────────────

export type MonsterFamilyMembersOutput = 'success' | 'error';

class MonsterFamilyMembersNode extends ScalarNode<ScrapeState, MonsterFamilyMembersOutput> {
  public readonly name = 'extract:monster-family-members';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<MonsterFamilyMembersOutput, SchemaObjectType> {
    return {
      success: { type: 'object', properties: { output: { type: 'object' } }, required: ['output'] },
      error:   { type: 'object' },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<MonsterFamilyMembersOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const members = extractMonsterFamilyMembers(common);

    state.output = { ...state.output, ...members };

    return NodeOutputBuilder.of('success');
  }
}

export const monsterFamilyMembersNode = new MonsterFamilyMembersNode();

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeMonsterFamilyOutput = 'success';

class FinalizeMonsterFamilyNode extends ScalarNode<ScrapeState, FinalizeMonsterFamilyOutput> {
  public readonly name = 'finalize:monster-family';
  public readonly outputs = ['success'] as const;

  public override get outputSchema(): Record<FinalizeMonsterFamilyOutput, SchemaObjectType> {
    return {
      success: { type: 'object', properties: { output: { type: 'object' } }, required: ['output'] },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<FinalizeMonsterFamilyOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root   = state.getMetadata<CheerioAPI>('aonprdCheerio');
    if (common === undefined || root === undefined) return NodeOutputBuilder.of('success');
    const acc = (state.output ?? {}) as unknown as MonsterFamilyOutput;
    const assembled = finalizeMonsterFamily(common, acc, acc, root);
    setConceptOutput(state, assembled);

    return NodeOutputBuilder.of('success');
  }
}

export const finalizeMonsterFamilyNode = new FinalizeMonsterFamilyNode();

// ─── ConceptDecl export ───────────────────────────────────────────────────────

export const monsterFamilyConcept: ConceptDecl<MonsterFamilyOutput> = {
  id:       'monster-family',
  parent:   'entity',
  urlPaths: ['monsterfamilies'],
  capabilities: [
    monsterFamilyBaseNode,
    monsterFamilyMembersNode,
    finalizeMonsterFamilyNode,
  ],
};
