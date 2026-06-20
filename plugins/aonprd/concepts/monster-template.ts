//
// Monster-template pages describe creature adjustment templates (Elite, Weak,
// Undead, etc.) with bullet adjustments, optional subsections, HP tables, and
// best-effort numeric delta parsing.
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
  const regex = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const inner = match[1] ?? '';
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
  const match = /<h3\b[^>]*class="[^"]*title[^"]*"[^>]*>/i.exec(html);
  if (match === null) return { head: html, rest: '' };
  return { head: html.slice(0, match.index), rest: html.slice(match.index) };
}

/**
 * Walk `<h3 class="title">…</h3>` headings inside the body. Each heading owns
 * everything from the close of its tag to the next `<h3 class="title">` or end
 * of fragment.
 */
function parseSubsections(html: string): MonsterTemplateSubsection[] {
  const out: MonsterTemplateSubsection[] = [];
  const regex = /<h3\b[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/h3>/gi;
  const matches: Array<{ heading: string; start: number; end: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    matches.push({
      heading: htmlToText(match[1] ?? ''),
      start:   match.index,
      end:     match.index + match[0].length,
    });
  }
  for (let index = 0; index < matches.length; index++) {
    const cur  = matches[index]!;
    const next = index + 1 < matches.length ? matches[index + 1]!.start : html.length;
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
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(tableHtml)) !== null) {
    const rowHtml = rowMatch[1] ?? '';
    const cells: string[] = [];
    const cellRe = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(rowHtml)) !== null) cells.push(htmlToText(cellMatch[1] ?? ''));
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
  let regex: RegExp;
  if (kind === 'level') {
    regex = /(increase|reduce|decrease)[^.]{0,40}\blevel\b[^.]{0,40}?\bby\s+(\d+)/i;
  } else if (kind === 'attack') {
    regex = /(increase|reduce|decrease)[^.]{0,80}?\b(?:ac|attack(?:\s+modifiers?)?|dcs?|saving\s+throws?|perception|skill\s+modifiers?)\b[^.]{0,80}?\bby\s+(\d+)/i;
  } else {
    regex = /(increase|reduce|decrease)[^.]{0,40}?damage[^.]{0,80}?strikes?[^.]{0,40}?\bby\s+(\d+)/i;
  }
  const match = regex.exec(lower);
  if (match === null) return null;
  const num = parseInt(match[2]!, 10);
  if (!Number.isFinite(num)) return null;
  const sign = /increase/i.test(match[1]!) ? 1 : -1;
  return sign * num;
}

// ─── Per-slice extraction helpers ─────────────────────────────────────────────

/** Extract base identity + header scalars for a monster-template page. */
export function extractMonsterTemplateBase(common: CommonExtraction): MonsterTemplateBaseSlice {
  return {
    url:             common.url,
    template_id:     extractEntityId(common.url),
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

/** Extract bullet adjustments + subsections + HP table + numeric deltas. */
export function extractMonsterTemplateModifications(common: CommonExtraction): MonsterTemplateModificationsSlice {
  const { head, rest } = splitOnFirstH3(common.body_html);
  const adjustments = parseBulletList(head);
  const subsections = parseSubsections(rest);
  const hp_table    = parseHpTable(common.body_html);
  const flat = common.body_text;
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
export function extractMonsterTemplateMeta(_common: CommonExtraction): MonsterTemplateMetaSlice {
  return { __monster_template_meta_marked: true };
}

// ─── Finalize ────────────────────────────────────────────────────────────────

const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Source',
];

export function finalizeMonsterTemplate(
  common:        CommonExtraction,
  base:          MonsterTemplateBaseSlice,
  modifications: MonsterTemplateModificationsSlice,
  _meta:         MonsterTemplateMetaSlice,
  root:          CheerioAPI,
  _target:       CheerioNode,
): MonsterTemplateOutput {
  void _meta;
  void _target;
  const raw_fields = stripStructuredKeys(common.field_map, CLAIMED_FIELD_LABELS);
  return {
    ...base,
    ...modifications,
    sections:         common.sections,
    raw_fields,
    links:            common.links,
    body_text:        common.body_text,
    body_html:        common.body_html,
    meta_description: extractMetaDescription(root),
    meta_keywords:    extractMetaKeywords(root),
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
  common: CommonExtraction,
  root:   CheerioAPI,
  target: CheerioNode,
): MonsterTemplateOutput {
  const base          = extractMonsterTemplateBase(common);
  const modifications = extractMonsterTemplateModifications(common);
  const meta          = extractMonsterTemplateMeta(common);
  return finalizeMonsterTemplate(common, base, modifications, meta, root, target);
}

// Re-export output type so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

export type MonsterTemplateBaseOutput = 'success' | 'error';

class MonsterTemplateBaseNode extends ScalarNode<ScrapeState, MonsterTemplateBaseOutput> {
  public readonly name = 'extract:monster-template-base';
  public readonly outputs = CAPABILITY_OUTPUTS;
  public override readonly contract: OperationContractFragmentType = {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  };

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<MonsterTemplateBaseOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const base = extractMonsterTemplateBase(common);

    state.output = { ...state.output, ...base };

    return NodeOutputBuilder.of('success');
  }
}

export const monsterTemplateBaseNode = new MonsterTemplateBaseNode();

// ─────────────────────────────────────────────────────────────────────────────

export type MonsterTemplateModificationsOutput = 'success' | 'error';

class MonsterTemplateModificationsNode extends ScalarNode<ScrapeState, MonsterTemplateModificationsOutput> {
  public readonly name = 'extract:monster-template-modifications';
  public readonly outputs = CAPABILITY_OUTPUTS;
  public override readonly contract: OperationContractFragmentType = {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  };

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<MonsterTemplateModificationsOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const modifications = extractMonsterTemplateModifications(common);

    state.output = { ...state.output, ...modifications };

    return NodeOutputBuilder.of('success');
  }
}

export const monsterTemplateModificationsNode = new MonsterTemplateModificationsNode();

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeMonsterTemplateOutput = 'success';

class FinalizeMonsterTemplateNode extends ScalarNode<ScrapeState, FinalizeMonsterTemplateOutput> {
  public readonly name = 'finalize:monster-template';
  public readonly outputs = ['success'] as const;
  public override readonly contract: OperationContractFragmentType = {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'aonprdTarget'] as const,
    produces:     [] as const,
  };

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<FinalizeMonsterTemplateOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root   = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (common === undefined || root === undefined || target === undefined) return NodeOutputBuilder.of('success');
    const acc = (state.output ?? {}) as unknown as MonsterTemplateOutput;
    const assembled = finalizeMonsterTemplate(common, (acc as never), (acc as never), (acc as never), root, target);
    setConceptOutput(state, assembled);

    return NodeOutputBuilder.of('success');
  }
}

export const finalizeMonsterTemplateNode = new FinalizeMonsterTemplateNode();

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
