//
// Kingmaker mass-combat army stat-block pages (KMWarArmies.aspx) carry
// scouting, recruitment, consumption, a description prose line, AC, maneuver,
// morale, HP, melee/ranged attacks, and named ability blocks. This concept
// Helpers are inlined.
//
// bespoke node-folder under nodes/km-war-army/.
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
  type SourceRef,
  type Section,
  type PfsLegality,
  htmlToText,
  getField,
  asInt,
  extractEntityId,
  extractMetaDescription,
  extractMetaKeywords,
  stripStructuredKeys,
} from '../common.js';

/** A named ability block on an army page. */
export interface KmWarArmyAbility {
  /** Bold label of the ability — e.g. "Swamp Dwellers", "Darkvision". */
  name:      string;
  /** Parenthetical qualifier after the label — "unique tactic", "tactic", etc. */
  qualifier: string | null;
  /** Prose body of the ability after the qualifier. */
  text:      string;
}

/** A combat-attack line — Melee / Ranged. */
export interface KmWarArmyAttack {
  /** Verbatim raw attack line. */
  raw: string;
  /** Numeric attack bonus when extractable. */
  bonus: number | null;
  /** Shot count for ranged attacks ("5 shots" → 5). */
  shots: number | null;
}

export interface KmWarArmyOutput {
  url:             string;
  army_id:         number | null;
  name:            string;
  rarity:          Rarity;
  traits:          string[];
  trait_ids:       Record<string, number>;
  /** "Army N" level marker. */
  level:           number | null;
  /** Army-type tag picked from traits (first match: Infantry/Skirmisher/Cavalry/Siege). */
  ancestry:        string | null;
  source:          { book: string | null; page: number | null; source_id: number | null };
  sources:         SourceRef[];
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;

  // Statblock
  scouting:    string | null;
  recruitment: string | null;
  consumption: string | null;
  description: string;
  ac:          string | null;
  maneuver:    string | null;
  morale:      string | null;
  hp:          string | null;
  melee:       KmWarArmyAttack | null;
  ranged:      KmWarArmyAttack | null;

  // Abilities (named tactic blocks)
  abilities: KmWarArmyAbility[];

  // Bookkeeping
  sections:         Section[];
  raw_fields:       Record<string, string>;
  links:            LinkRef[];
  body_text:        string;
  body_html:        string;
  meta_description: string | null;
  meta_keywords:    string | null;
}

export interface KmWarArmyBaseSlice {
  url:             string;
  army_id:         number | null;
  name:            string;
  rarity:          Rarity;
  traits:          string[];
  trait_ids:       Record<string, number>;
  level:           number | null;
  ancestry:        string | null;
  source:          KmWarArmyOutput['source'];
  sources:         SourceRef[];
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;
}

export interface KmWarArmyStatblockSlice {
  scouting:    string | null;
  recruitment: string | null;
  consumption: string | null;
  description: string;
  ac:          string | null;
  maneuver:    string | null;
  morale:      string | null;
  hp:          string | null;
  melee:       KmWarArmyAttack | null;
  ranged:      KmWarArmyAttack | null;
}

export interface KmWarArmyAbilitiesSlice {
  abilities: KmWarArmyAbility[];
}

export interface KmWarArmyMetaSlice {
  __km_war_army_meta_marked: true;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ARMY_TYPE_TAGS: ReadonlySet<string> = new Set(['Infantry', 'Skirmisher', 'Cavalry', 'Siege']);

function pickAncestryTag(traits: ReadonlyArray<string>): string | null {
  for (const trait of traits) {
    if (ARMY_TYPE_TAGS.has(trait)) return trait;
  }
  return null;
}

function clean(str: string | null): string | null {
  if (str === null) return null;
  const trimmed = str.trim().replace(/[;,]\s*$/, '').trim();
  return trimmed === '' ? null : trimmed;
}

/** Parse an attack line: "weapons +9" → {bonus: 9}; "javelins +12 (5 shots)" → {bonus:12, shots:5}. */
function parseAttack(raw: string | null): KmWarArmyAttack | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const bonusM = /([+-]\d+)/.exec(trimmed);
  const bonus  = bonusM !== null ? asInt(bonusM[1]!) : null;
  const shotsM = /\((\d+)\s*shots?\)/i.exec(trimmed);
  const shots  = shotsM !== null ? parseInt(shotsM[1]!, 10) : null;
  return { raw: trimmed, bonus, shots: Number.isFinite(shots ?? NaN) ? shots : null };
}

/** Pick a label value with the standard <b>Label</b> ... boundary. */
function pickValue(body: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const labelRe = new RegExp(`<b>\\s*${escaped}\\s*<\\/b>`, 'i');
  const match = labelRe.exec(body);
  if (match === null) return null;
  const start    = match.index + match[0].length;
  const rest     = body.slice(start);
  const boundary = /<b>|<br\s*\/?>|<\/span>|<h[23]\s+class="title"/i.exec(rest);
  const end      = boundary !== null ? boundary.index : rest.length;
  const value    = rest.slice(0, end).trim();
  if (value === '') return null;
  return clean(htmlToText(value));
}

/** Extract the description prose line (after Recruitment/Consumption and before AC). */
function extractDescription(body: string): string {
  // Body shape: …<b>Consumption</b> N<br/>DESCRIPTION_PROSE<br/><b>AC</b>…
  // Cut between the <br/> after Consumption and the <b>AC</b> label.
  const consRe = /<b>\s*Consumption\s*<\/b>[^<]*<br\s*\/?>/i;
  const acRe   = /<b>\s*AC\s*<\/b>/i;
  const consM  = consRe.exec(body);
  const acM    = acRe.exec(body);
  if (consM === null || acM === null) return '';
  const start = consM.index + consM[0].length;
  const end   = acM.index;
  if (end <= start) return '';
  return htmlToText(body.slice(start, end)).trim();
}

/** Locate the start index of the abilities section — first `<b>` after Ranged or Melee line ends. */
function abilitiesStart(body: string): number {
  // Look for the last of {Ranged, Melee, HP} lines, then take everything after
  // its closing <br/>. The first <b>X</b> (qualifier) after that is an ability.
  const labels: RegExp[] = [
    /<b>\s*Ranged\s*<\/b>[\s\S]*?<br\s*\/?>/i,
    /<b>\s*Melee\s*<\/b>[\s\S]*?<br\s*\/?>/i,
    /<b>\s*HP\s*<\/b>[\s\S]*?<br\s*\/?>/i,
  ];
  let pos = -1;
  for (const regex of labels) {
    const match = regex.exec(body);
    if (match === null) continue;
    const end = match.index + match[0].length;
    if (end > pos) pos = end;
  }
  return pos;
}

const NON_ABILITY_LABELS: ReadonlySet<string> = new Set([
  'source', 'scouting', 'scout', 'recruitment', 'consumption',
  'ac', 'maneuver', 'morale', 'hp', 'melee', 'ranged',
]);

/** Walk every `<b>Name</b> ...` block after the statblock and pull abilities. */
function parseAbilities(body: string): KmWarArmyAbility[] {
  const start = abilitiesStart(body);
  if (start < 0) return [];
  const tail = body.slice(start);
  const out: KmWarArmyAbility[] = [];
  const regex = /<b>\s*([^<]+?)\s*<\/b>\s*([\s\S]*?)(?=<b>|<\/span>|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(tail)) !== null) {
    const name = (match[1] ?? '').trim();
    if (name === '') continue;
    if (NON_ABILITY_LABELS.has(name.toLowerCase())) continue;
    const rest = (match[2] ?? '').replace(/^\s*[:;,]\s*/, '');
    // Optional `(qualifier) text` at the start of the value.
    const qualMatch = /^\(([^)]+)\)\s*([\s\S]*)$/.exec(rest);
    const qualifier = qualMatch !== null ? qualMatch[1]!.trim() : null;
    const valueHtml = qualMatch !== null ? (qualMatch[2] ?? '') : rest;
    const text = htmlToText(valueHtml).trim();
    out.push({ name, qualifier, text });
  }
  return out;
}

// ─── Per-slice extraction helpers ─────────────────────────────────────────────

export function extractKmWarArmyBase(common: CommonExtraction): KmWarArmyBaseSlice {
  return {
    url:             common.url,
    army_id:         extractEntityId(common.url),
    name:            common.title.name,
    rarity:          common.traits.rarity,
    traits:          common.traits.traits,
    trait_ids:       common.traits.trait_ids,
    level:           common.title.level,
    ancestry:        pickAncestryTag(common.traits.traits),
    source:          { book: common.source.book, page: common.source.page, source_id: common.source.source_id },
    sources:         common.sources,
    pfs:             common.title.pfs,
    legacy:          common.title.legacy,
    alt_edition_url: common.title.alt_edition_url,
  };
}

export function extractKmWarArmyStatblock(common: CommonExtraction): KmWarArmyStatblockSlice {
  const body = common.body_html;
  const fromField = (...keys: string[]): string | null => clean(getField(common, ...keys));

  // Stats sometimes appear in field_map (when harvestFields can see them) or
  // only in body — try both.
  const scouting    = fromField('Scouting', 'Scout')    ?? pickValue(body, 'Scouting') ?? pickValue(body, 'Scout');
  const recruitment = fromField('Recruitment')          ?? pickValue(body, 'Recruitment');
  const consumption = fromField('Consumption')          ?? pickValue(body, 'Consumption');
  const armorClass  = fromField('AC')                   ?? pickValue(body, 'AC');
  const maneuver    = fromField('Maneuver')             ?? pickValue(body, 'Maneuver');
  const morale      = fromField('Morale')               ?? pickValue(body, 'Morale');
  const hitPoints   = fromField('HP')                   ?? pickValue(body, 'HP');
  const meleeRaw    = fromField('Melee')                ?? pickValue(body, 'Melee');
  const rangedRaw   = fromField('Ranged')               ?? pickValue(body, 'Ranged');

  return {
    scouting,
    recruitment,
    consumption,
    description: extractDescription(body),
    ac:      armorClass,
    maneuver,
    morale,
    hp:      hitPoints,
    melee:   parseAttack(meleeRaw),
    ranged:  parseAttack(rangedRaw),
  };
}

export function extractKmWarArmyAbilities(common: CommonExtraction): KmWarArmyAbilitiesSlice {
  return { abilities: parseAbilities(common.body_html) };
}

export function extractKmWarArmyMeta(_common: CommonExtraction): KmWarArmyMetaSlice {
  return { __km_war_army_meta_marked: true };
}

const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Source',
  'Scouting', 'Scout',
  'Recruitment', 'Consumption',
  'AC', 'Maneuver', 'Morale', 'HP',
  'Melee', 'Ranged',
];

export function finalizeKmWarArmy(
  common:    CommonExtraction,
  base:      KmWarArmyBaseSlice,
  stat:      KmWarArmyStatblockSlice,
  abilities: KmWarArmyAbilitiesSlice,
  _meta:     KmWarArmyMetaSlice,
  root:      CheerioAPI,
): KmWarArmyOutput {
  void _meta;
  return {
    ...base,
    ...stat,
    abilities:        abilities.abilities,
    sections:         common.sections,
    raw_fields:       stripStructuredKeys(common.field_map, CLAIMED_FIELD_LABELS),
    links:            common.links,
    body_text:        common.body_text,
    body_html:        common.body_html,
    meta_description: extractMetaDescription(root),
    meta_keywords:    extractMetaKeywords(root),
  } satisfies KmWarArmyOutput;
}

export function extractKmWarArmy(common: CommonExtraction, root: CheerioAPI, target: CheerioNode): KmWarArmyOutput {
  void target;
  const base      = extractKmWarArmyBase(common);
  const stat      = extractKmWarArmyStatblock(common);
  const abilities = extractKmWarArmyAbilities(common);
  const meta      = extractKmWarArmyMeta(common);
  return finalizeKmWarArmy(common, base, stat, abilities, meta, root);
}

// Re-export output type so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

export type KmWarArmyBaseOutput = 'success' | 'error';

class KmWarArmyBaseNode extends ScalarNode<ScrapeState, KmWarArmyBaseOutput> {
  public readonly name = 'extract:km-war-army-base';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<KmWarArmyBaseOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const base = extractKmWarArmyBase(common);

    state.output = { ...state.output, ...base };

    return NodeOutputBuilder.of('success');
  }
}

export const kmWarArmyBaseNode = new KmWarArmyBaseNode();

// ─────────────────────────────────────────────────────────────────────────────

export type KmWarArmyStatblockOutput = 'success' | 'error';

class KmWarArmyStatblockNode extends ScalarNode<ScrapeState, KmWarArmyStatblockOutput> {
  public readonly name = 'extract:km-war-army-statblock';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<KmWarArmyStatblockOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const stat = extractKmWarArmyStatblock(common);

    state.output = { ...state.output, ...stat };

    return NodeOutputBuilder.of('success');
  }
}

export const kmWarArmyStatblockNode = new KmWarArmyStatblockNode();

// ─────────────────────────────────────────────────────────────────────────────

export type KmWarArmyAbilitiesOutput = 'success' | 'error';

class KmWarArmyAbilitiesNode extends ScalarNode<ScrapeState, KmWarArmyAbilitiesOutput> {
  public readonly name = 'extract:km-war-army-abilities';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<KmWarArmyAbilitiesOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const slice = extractKmWarArmyAbilities(common);

    state.output = { ...state.output, ...slice };

    return NodeOutputBuilder.of('success');
  }
}

export const kmWarArmyAbilitiesNode = new KmWarArmyAbilitiesNode();

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeKmWarArmyOutput = 'success';

class FinalizeKmWarArmyNode extends ScalarNode<ScrapeState, FinalizeKmWarArmyOutput> {
  public readonly name = 'finalize:km-war-army';
  public readonly outputs = ['success'] as const;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<FinalizeKmWarArmyOutput>> {
    const common  = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root    = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target  = state.getMetadata<CheerioNode>('aonprdTarget');
    if (common === undefined || root === undefined) return NodeOutputBuilder.of('success');

    // meta arg is unused by finalizeKmWarArmy (marker only)
    const acc = (state.output ?? {}) as unknown as KmWarArmyOutput;
    const assembled = finalizeKmWarArmy(common, acc, acc, acc, { __km_war_army_meta_marked: true }, root);
    void target;

    setConceptOutput(state, assembled);

    return NodeOutputBuilder.of('success');
  }
}

export const finalizeKmWarArmyNode = new FinalizeKmWarArmyNode();

// ─── ConceptDecl export ───────────────────────────────────────────────────────

export const kmWarArmyConcept: ConceptDecl<KmWarArmyOutput> = {
  id:       'km-war-army',
  parent:   'entity',
  urlPaths: ['kmwararmies'],
  capabilities: [
    kmWarArmyBaseNode,
    kmWarArmyStatblockNode,
    kmWarArmyAbilitiesNode,
    finalizeKmWarArmyNode,
  ],
};
