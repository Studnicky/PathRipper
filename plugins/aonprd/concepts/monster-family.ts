// Monster-family concept — Phase 6.4 taxonomic extraction.
//
// Delegates to Wave 5 slice helpers in monster-family.ts for correctness.
// Byte-equivalent to Wave 5 shape — monster-family pages are lore + member-list
// pages with minimal structured data; the Wave 5 helpers already handle the
// Members framing section harvest and family identity.
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
  htmlToText,
  extractEntityId,
  extractMetaDescription,
  extractMetaKeywords,
  stripStructuredKeys,
} from '../common.js';

// ─── Inlined from Wave 5: monster-family.ts ──────────────────────────────────
// ─── Output type ──────────────────────────────────────────────────────────────

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
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(fragment)) !== null) {
    const href   = m[1] ?? '';
    const inner  = m[2] ?? '';
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
export function extractMonsterFamilyBase(c: CommonExtraction): MonsterFamilyBaseSlice {
  return {
    url:             c.url,
    monster_family_id:       extractEntityId(c.url),
    name:            c.title.name,
    rarity:          c.traits.rarity,
    pfs:             c.title.pfs,
    legacy:          c.title.legacy,
    alt_edition_url: c.title.alt_edition_url,
    traits:          c.traits.traits,
    trait_ids:       c.traits.trait_ids,
    source:          { book: c.source.book, page: c.source.page, source_id: c.source.source_id },
    sources:         c.sources,
  };
}

/** Extract the member-creature list from the `Members` framing section. */
export function extractMonsterFamilyMembers(c: CommonExtraction): MonsterFamilyMembersSlice {
  return { members: parseMembers(c.body_html) };
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
  c:       CommonExtraction,
  base:    MonsterFamilyBaseSlice,
  members: MonsterFamilyMembersSlice,
  $:       CheerioAPI,
): MonsterFamilyOutput {
  const raw_fields = stripStructuredKeys(c.field_map, CLAIMED_FIELD_LABELS);
  return {
    ...base,
    sections:         c.sections,
    raw_fields,
    links:            c.links,
    body_text:        c.body_text,
    body_html:        c.body_html,
    members:          members.members,
    meta_description: extractMetaDescription($),
    meta_keywords:    extractMetaKeywords($),
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
  c:    CommonExtraction,
  $:    CheerioAPI,
  _span: CheerioNode,
): MonsterFamilyOutput {
  void _span;
  const base    = extractMonsterFamilyBase(c);
  const members = extractMonsterFamilyMembers(c);
  return finalizeMonsterFamily(c, base, members, $);
}

// Re-export output type so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

export type MonsterFamilyBaseOutput = 'success' | 'error';

export const monsterFamilyBaseNode: NodeInterface<ScrapeState, MonsterFamilyBaseOutput, RipperServices> = {
  name:    'extract:monster-family-base',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: MonsterFamilyBaseOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const base = extractMonsterFamilyBase(c);

    state.output = { ...state.output, ...base };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type MonsterFamilyMembersOutput = 'success' | 'error';

export const monsterFamilyMembersNode: NodeInterface<ScrapeState, MonsterFamilyMembersOutput, RipperServices> = {
  name:    'extract:monster-family-members',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: MonsterFamilyMembersOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const members = extractMonsterFamilyMembers(c);

    state.output = { ...state.output, ...members };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeMonsterFamilyOutput = 'success';

export const finalizeMonsterFamilyNode: NodeInterface<ScrapeState, FinalizeMonsterFamilyOutput, RipperServices> = {
  name:    'finalize:monster-family',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FinalizeMonsterFamilyOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $ = state.getMetadata<CheerioAPI>('aonprdCheerio');
    if (c === undefined || $ === undefined) return { output: 'success' };
    const acc = (state.output ?? {}) as unknown as MonsterFamilyOutput;
    const assembled = finalizeMonsterFamily(c, acc, acc, $);
    setConceptOutput(state, assembled);

    return { output: 'success' };
  },
};

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
