//
// Monster-template pages describe creature adjustment templates (Elite, Weak,
// Undead, etc.) with bullet adjustments, optional subsections, HP tables, and
// best-effort numeric delta parsing.
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

// ─── Output types ─────────────────────────────────────────────────────────────

/** A single bullet from a `<ul><li>…</li></ul>` adjustment list. */
export interface MonsterTemplateAdjustment {
  /** Flattened bullet text. */
  text: string;
  /** Verbatim HTML of the bullet's inner content. */
  html: string;
}

/** A row from a starting-level → HP-increase adjustment table. */
export interface MonsterTemplateHpRow {
  /** Raw starting-level label, e.g. "1 or lower", "2-4", "5-19", "20+". */
  starting_level: string;
  /** HP increase amount, parsed as integer where possible. */
  hp_increase:    number | null;
  /** Verbatim cell text for hp_increase. */
  hp_increase_raw: string;
}

/** A `<h3 class="title">` subsection nested within a template page. */
export interface MonsterTemplateSubsection {
  /** Heading text, e.g. "Undead Adjustments", "Skeleton Adjustments". */
  heading:   string;
  /** Flattened prose body of the subsection. */
  body_text: string;
  /** Verbatim HTML of the subsection body. */
  body_html: string;
  /** Bullet-list adjustments inside the subsection. */
  adjustments: MonsterTemplateAdjustment[];
}

export interface MonsterTemplateOutput {
  url:                string;
  /** Numeric AON MonsterTemplates.aspx ID extracted from the URL query string. */
  template_id:        number | null;
  name:               string;
  rarity:             Rarity;
  pfs:                PfsLegality | null;
  legacy:             boolean;
  alt_edition_url:    string | null;
  traits:             string[];
  trait_ids:          Record<string, number>;
  source:             { book: string | null; page: number | null; source_id: number | null };
  sources:            SourceRef[];

  // ─── Modifications ─────────────────────────────────────────────────────────
  /** Bullet-list adjustments at the top level of the template prose. */
  adjustments:        MonsterTemplateAdjustment[];
  /** Nested `<h3 class="title">` subsections (template variants). */
  subsections:        MonsterTemplateSubsection[];
  /** Starting-level → HP-increase rows when the page renders an adjustment table. */
  hp_table:           MonsterTemplateHpRow[];

  // ─── Parsed level/stat deltas (best-effort from prose) ─────────────────────
  /** Numeric level delta when prose says "Increase … level by N" / "Reduce … by N". */
  level_change:       number | null;
  /** Numeric AC / attack / DC / save / Perception / skill bump from elite/weak text. */
  ac_attack_dc_save_change: number | null;
  /** Numeric Strike-damage bump from elite/weak text. */
  strike_damage_change:     number | null;

  // ─── Bookkeeping ───────────────────────────────────────────────────────────
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

/** Fields owned by `extract-monster-template-base`. */
export interface MonsterTemplateBaseSlice {
  url:             string;
  template_id:     number | null;
  name:            string;
  rarity:          Rarity;
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;
  traits:          string[];
  trait_ids:       Record<string, number>;
  source:          MonsterTemplateOutput['source'];
  sources:         SourceRef[];
}

/** Fields owned by `extract-monster-template-modifications`. */
export interface MonsterTemplateModificationsSlice {
  adjustments:              MonsterTemplateAdjustment[];
  subsections:              MonsterTemplateSubsection[];
  hp_table:                 MonsterTemplateHpRow[];
  level_change:             number | null;
  ac_attack_dc_save_change: number | null;
  strike_damage_change:     number | null;
}

/** Fields owned by `extract-monster-template-meta`. */
export interface MonsterTemplateMetaSlice {
  /** Marker so `state.output` accumulates the slice. */
  __monster_template_meta_marked: true;
}

// ─── Parsers ─────────────────────────────────────────────────────────────────

/** Parse `<ul><li>…</li></ul>` items out of a fragment, preserving order. */
function parseBulletList(html: string): MonsterTemplateAdjustment[] {
  const out: MonsterTemplateAdjustment[] = [];
  const re = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const inner = m[1] ?? '';
    const text = htmlToText(inner);
    if (text === '') continue;
    out.push({ text, html: inner.trim() });
  }
  return out;
}

/**
 * Cut the body HTML at the first `<h3 class="title">` boundary so top-level
 * adjustments don't bleed into the subsection slot, and so subsections aren't
 * captured twice.
 */
function splitOnFirstH3(html: string): { head: string; rest: string } {
  const m = /<h3\b[^>]*class="[^"]*title[^"]*"[^>]*>/i.exec(html);
  if (m === null) return { head: html, rest: '' };
  return { head: html.slice(0, m.index), rest: html.slice(m.index) };
}

/**
 * Walk `<h3 class="title">…</h3>` headings inside the body. Each heading owns
 * everything from the close of its tag to the next `<h3 class="title">` or end
 * of fragment.
 */
function parseSubsections(html: string): MonsterTemplateSubsection[] {
  const out: MonsterTemplateSubsection[] = [];
  const re = /<h3\b[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/h3>/gi;
  const matches: Array<{ heading: string; start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    matches.push({
      heading: htmlToText(m[1] ?? ''),
      start:   m.index,
      end:     m.index + m[0].length,
    });
  }
  for (let i = 0; i < matches.length; i++) {
    const cur  = matches[i]!;
    const next = i + 1 < matches.length ? matches[i + 1]!.start : html.length;
    const body_html = html.slice(cur.end, next).trim();
    out.push({
      heading:     cur.heading,
      body_html,
      body_text:   htmlToText(body_html),
      adjustments: parseBulletList(body_html),
    });
  }
  return out;
}

/** Parse `<table class="inner">` rows into starting-level → HP-increase pairs. */
function parseHpTable(html: string): MonsterTemplateHpRow[] {
  const tableMatch = /<table\b[^>]*class="[^"]*inner[^"]*"[^>]*>([\s\S]*?)<\/table>/i.exec(html);
  if (tableMatch === null) return [];
  const tableHtml = tableMatch[1] ?? '';
  const out: MonsterTemplateHpRow[] = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let r: RegExpExecArray | null;
  while ((r = rowRe.exec(tableHtml)) !== null) {
    const rowHtml = r[1] ?? '';
    const cells: string[] = [];
    const cellRe = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
    let c: RegExpExecArray | null;
    while ((c = cellRe.exec(rowHtml)) !== null) cells.push(htmlToText(c[1] ?? ''));
    if (cells.length < 2) continue;
    // Skip header row (contains bolded labels like "Starting Level" / "HP Increase").
    if (/starting level/i.test(cells[0]!) && /hp/i.test(cells[1]!)) continue;
    const hpRaw = cells[1]!;
    const hpMatch = /-?\d+/.exec(hpRaw);
    const hp_increase = hpMatch !== null ? parseInt(hpMatch[0], 10) : null;
    out.push({
      starting_level:  cells[0]!,
      hp_increase:     Number.isFinite(hp_increase ?? NaN) ? hp_increase : null,
      hp_increase_raw: hpRaw,
    });
  }
  return out;
}

/**
 * Best-effort parse of numeric deltas from elite/weak/mythic prose:
 *   "Increase the creature's level by 1" → +1
 *   "decrease the creature's level by 1" / "reduce … by 1" → -1
 *   "Increase the creature's AC, attack modifiers, DCs, saving throws … by 2" → ±2
 *   "Increase the damage of its Strikes … by 2" → ±2
 */
function parseStatChange(text: string, kind: 'level' | 'attack' | 'damage'): number | null {
  const lower = text.toLowerCase();
  // Tightly scoped regexes — fall back to null when the page uses prose patterns
  // that don't match (e.g. undead templates which describe additions, not deltas).
  let re: RegExp;
  if (kind === 'level') {
    re = /(increase|reduce|decrease)[^.]{0,40}\blevel\b[^.]{0,40}?\bby\s+(\d+)/i;
  } else if (kind === 'attack') {
    re = /(increase|reduce|decrease)[^.]{0,80}?\b(?:ac|attack(?:\s+modifiers?)?|dcs?|saving\s+throws?|perception|skill\s+modifiers?)\b[^.]{0,80}?\bby\s+(\d+)/i;
  } else {
    re = /(increase|reduce|decrease)[^.]{0,40}?damage[^.]{0,80}?strikes?[^.]{0,40}?\bby\s+(\d+)/i;
  }
  const m = re.exec(lower);
  if (m === null) return null;
  const n = parseInt(m[2]!, 10);
  if (!Number.isFinite(n)) return null;
  const sign = /increase/i.test(m[1]!) ? 1 : -1;
  return sign * n;
}

// ─── Per-slice extraction helpers ─────────────────────────────────────────────

/** Extract base identity + header scalars for a monster-template page. */
export function extractMonsterTemplateBase(c: CommonExtraction): MonsterTemplateBaseSlice {
  return {
    url:             c.url,
    template_id:     extractEntityId(c.url),
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

/** Extract bullet adjustments + subsections + HP table + numeric deltas. */
export function extractMonsterTemplateModifications(c: CommonExtraction): MonsterTemplateModificationsSlice {
  const { head, rest } = splitOnFirstH3(c.body_html);
  const adjustments = parseBulletList(head);
  const subsections = parseSubsections(rest);
  const hp_table    = parseHpTable(c.body_html);
  const flat = c.body_text;
  return {
    adjustments,
    subsections,
    hp_table,
    level_change:             parseStatChange(flat, 'level'),
    ac_attack_dc_save_change: parseStatChange(flat, 'attack'),
    strike_damage_change:     parseStatChange(flat, 'damage'),
  };
}

/** Meta marker — body/sections/links/meta attach during finalize. */
export function extractMonsterTemplateMeta(_c: CommonExtraction): MonsterTemplateMetaSlice {
  return { __monster_template_meta_marked: true };
}

// ─── Finalize ────────────────────────────────────────────────────────────────

const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Source',
];

export function finalizeMonsterTemplate(
  c:             CommonExtraction,
  base:          MonsterTemplateBaseSlice,
  modifications: MonsterTemplateModificationsSlice,
  _meta:         MonsterTemplateMetaSlice,
  $:             CheerioAPI,
  _target:       CheerioNode,
): MonsterTemplateOutput {
  void _meta;
  void _target;
  const raw_fields = stripStructuredKeys(c.field_map, CLAIMED_FIELD_LABELS);
  return {
    ...base,
    ...modifications,
    sections:         c.sections,
    raw_fields,
    links:            c.links,
    body_text:        c.body_text,
    body_html:        c.body_html,
    meta_description: extractMetaDescription($),
    meta_keywords:    extractMetaKeywords($),
  } satisfies MonsterTemplateOutput;
}

/**
 * Project a MonsterTemplates.aspx page into a typed MonsterTemplateOutput.
 *
 * Thin assembly wrapper kept for `parseAonHtml` direct-call paths and unit
 * tests. The DAG pipeline calls the per-slice helpers individually through
 * the decomposed monster-template extraction nodes.
 */
export function extractMonsterTemplate(
  c:      CommonExtraction,
  $:      CheerioAPI,
  target: CheerioNode,
): MonsterTemplateOutput {
  const base          = extractMonsterTemplateBase(c);
  const modifications = extractMonsterTemplateModifications(c);
  const meta          = extractMonsterTemplateMeta(c);
  return finalizeMonsterTemplate(c, base, modifications, meta, $, target);
}

// Re-export output type so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

export type MonsterTemplateBaseOutput = 'success' | 'error';

export const monsterTemplateBaseNode: NodeInterface<ScrapeState, MonsterTemplateBaseOutput, RipperServices> = {
  name:    'extract:monster-template-base',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: MonsterTemplateBaseOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const base = extractMonsterTemplateBase(c);

    state.output = { ...state.output, ...base };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type MonsterTemplateModificationsOutput = 'success' | 'error';

export const monsterTemplateModificationsNode: NodeInterface<ScrapeState, MonsterTemplateModificationsOutput, RipperServices> = {
  name:    'extract:monster-template-modifications',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: MonsterTemplateModificationsOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const modifications = extractMonsterTemplateModifications(c);

    state.output = { ...state.output, ...modifications };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeMonsterTemplateOutput = 'success';

export const finalizeMonsterTemplateNode: NodeInterface<ScrapeState, FinalizeMonsterTemplateOutput, RipperServices> = {
  name:    'finalize:monster-template',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'aonprdTarget'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FinalizeMonsterTemplateOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined || target === undefined) return { output: 'success' };
    const acc = (state.output ?? {}) as unknown as MonsterTemplateOutput;
    const assembled = finalizeMonsterTemplate(c, (acc as never), (acc as never), (acc as never), $, target);
    setConceptOutput(state, assembled);

    return { output: 'success' };
  },
};

// ─── ConceptDecl export ───────────────────────────────────────────────────────

export const monsterTemplateConcept: ConceptDecl<MonsterTemplateOutput> = {
  id:       'monster-template',
  parent:   'entity',
  urlPaths: ['monstertemplates'],
  capabilities: [
    monsterTemplateBaseNode,
    monsterTemplateModificationsNode,
    finalizeMonsterTemplateNode,
  ],
};
