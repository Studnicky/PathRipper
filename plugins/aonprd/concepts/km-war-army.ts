// KM-war-army concept — Phase 6.4 taxonomic extraction.
//
// Kingmaker mass-combat army stat-block pages (KMWarArmies.aspx) carry
// scouting, recruitment, consumption, a description prose line, AC, maneuver,
// morale, HP, melee/ranged attacks, and named ability blocks. This concept
// delegates to Wave 5 slice helpers in km-war-army.ts for correctness. Output
// is byte-equivalent to the Wave 5 baseline.
//
// Improvement vs Wave 5: capabilities co-located with inline contracts; no
// bespoke node-folder under nodes/km-war-army/.
import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState }    from '../../../src/state/ScrapeState.js';
import type { RipperServices } from '../../../src/services/RipperServices.js';
import type { ConceptDecl, ConceptOutputBase } from '../taxonomy.js';
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

// ─── Inlined from Wave 5: km-war-army.ts ──────────────────────────────────
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

export interface KmWarArmyOutputFields {
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

/** Full output shape — `_type` discriminator stamped by the router at chain entry. */
export type KmWarArmyOutput = ConceptOutputBase<'km-war-army'> & KmWarArmyOutputFields;

export interface KmWarArmyBaseSlice {
  url:             string;
  army_id:         number | null;
  name:            string;
  rarity:          Rarity;
  traits:          string[];
  trait_ids:       Record<string, number>;
  level:           number | null;
  ancestry:        string | null;
  source:          KmWarArmyOutputFields['source'];
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
  for (const t of traits) {
    if (ARMY_TYPE_TAGS.has(t)) return t;
  }
  return null;
}

function clean(s: string | null): string | null {
  if (s === null) return null;
  const t = s.trim().replace(/[;,]\s*$/, '').trim();
  return t === '' ? null : t;
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
  const m = labelRe.exec(body);
  if (m === null) return null;
  const start    = m.index + m[0].length;
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
  for (const re of labels) {
    const m = re.exec(body);
    if (m === null) continue;
    const end = m.index + m[0].length;
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
  const re = /<b>\s*([^<]+?)\s*<\/b>\s*([\s\S]*?)(?=<b>|<\/span>|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tail)) !== null) {
    const name = (m[1] ?? '').trim();
    if (name === '') continue;
    if (NON_ABILITY_LABELS.has(name.toLowerCase())) continue;
    const rest = (m[2] ?? '').replace(/^\s*[:;,]\s*/, '');
    // Optional `(qualifier) text` at the start of the value.
    const qm = /^\(([^)]+)\)\s*([\s\S]*)$/.exec(rest);
    const qualifier = qm !== null ? qm[1]!.trim() : null;
    const valueHtml = qm !== null ? (qm[2] ?? '') : rest;
    const text = htmlToText(valueHtml).trim();
    out.push({ name, qualifier, text });
  }
  return out;
}

// ─── Per-slice extraction helpers ─────────────────────────────────────────────

export function extractKmWarArmyBase(c: CommonExtraction): KmWarArmyBaseSlice {
  return {
    url:             c.url,
    army_id:         extractEntityId(c.url),
    name:            c.title.name,
    rarity:          c.traits.rarity,
    traits:          c.traits.traits,
    trait_ids:       c.traits.trait_ids,
    level:           c.title.level,
    ancestry:        pickAncestryTag(c.traits.traits),
    source:          { book: c.source.book, page: c.source.page, source_id: c.source.source_id },
    sources:         c.sources,
    pfs:             c.title.pfs,
    legacy:          c.title.legacy,
    alt_edition_url: c.title.alt_edition_url,
  };
}

export function extractKmWarArmyStatblock(c: CommonExtraction): KmWarArmyStatblockSlice {
  const body = c.body_html;
  const fromField = (...keys: string[]): string | null => clean(getField(c, ...keys));

  // Stats sometimes appear in field_map (when harvestFields can see them) or
  // only in body — try both.
  const scouting    = fromField('Scouting', 'Scout')    ?? pickValue(body, 'Scouting') ?? pickValue(body, 'Scout');
  const recruitment = fromField('Recruitment')          ?? pickValue(body, 'Recruitment');
  const consumption = fromField('Consumption')          ?? pickValue(body, 'Consumption');
  const ac          = fromField('AC')                   ?? pickValue(body, 'AC');
  const maneuver    = fromField('Maneuver')             ?? pickValue(body, 'Maneuver');
  const morale      = fromField('Morale')               ?? pickValue(body, 'Morale');
  const hp          = fromField('HP')                   ?? pickValue(body, 'HP');
  const meleeRaw    = fromField('Melee')                ?? pickValue(body, 'Melee');
  const rangedRaw   = fromField('Ranged')               ?? pickValue(body, 'Ranged');

  return {
    scouting,
    recruitment,
    consumption,
    description: extractDescription(body),
    ac,
    maneuver,
    morale,
    hp,
    melee:  parseAttack(meleeRaw),
    ranged: parseAttack(rangedRaw),
  };
}

export function extractKmWarArmyAbilities(c: CommonExtraction): KmWarArmyAbilitiesSlice {
  return { abilities: parseAbilities(c.body_html) };
}

export function extractKmWarArmyMeta(_c: CommonExtraction): KmWarArmyMetaSlice {
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
  c:         CommonExtraction,
  base:      KmWarArmyBaseSlice,
  stat:      KmWarArmyStatblockSlice,
  abilities: KmWarArmyAbilitiesSlice,
  _meta:     KmWarArmyMetaSlice,
  $:         CheerioAPI,
): KmWarArmyOutputFields {
  void _meta;
  return {
    ...base,
    ...stat,
    abilities:        abilities.abilities,
    sections:         c.sections,
    raw_fields:       stripStructuredKeys(c.field_map, CLAIMED_FIELD_LABELS),
    links:            c.links,
    body_text:        c.body_text,
    body_html:        c.body_html,
    meta_description: extractMetaDescription($),
    meta_keywords:    extractMetaKeywords($),
  } satisfies KmWarArmyOutputFields;
}

export function extractKmWarArmy(c: CommonExtraction, $: CheerioAPI, target: CheerioNode): KmWarArmyOutputFields {
  void target;
  const base      = extractKmWarArmyBase(c);
  const stat      = extractKmWarArmyStatblock(c);
  const abilities = extractKmWarArmyAbilities(c);
  const meta      = extractKmWarArmyMeta(c);
  return finalizeKmWarArmy(c, base, stat, abilities, meta, $);
}


// Re-export output type so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

export type KmWarArmyBaseOutput = 'success' | 'error';

export const kmWarArmyBaseNode: NodeInterface<ScrapeState, KmWarArmyBaseOutput, RipperServices> = {
  name:    'extract:km-war-army-base',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: KmWarArmyBaseOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const base = extractKmWarArmyBase(c);

    state.output = { ...state.output, ...base };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type KmWarArmyStatblockOutput = 'success' | 'error';

export const kmWarArmyStatblockNode: NodeInterface<ScrapeState, KmWarArmyStatblockOutput, RipperServices> = {
  name:    'extract:km-war-army-statblock',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: KmWarArmyStatblockOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const stat = extractKmWarArmyStatblock(c);

    state.output = { ...state.output, ...stat };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type KmWarArmyAbilitiesOutput = 'success' | 'error';

export const kmWarArmyAbilitiesNode: NodeInterface<ScrapeState, KmWarArmyAbilitiesOutput, RipperServices> = {
  name:    'extract:km-war-army-abilities',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: KmWarArmyAbilitiesOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const slice = extractKmWarArmyAbilities(c);

    state.output = { ...state.output, ...slice };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeKmWarArmyOutput = 'success';

export const finalizeKmWarArmyNode: NodeInterface<ScrapeState, FinalizeKmWarArmyOutput, RipperServices> = {
  name:    'finalize:km-war-army',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FinalizeKmWarArmyOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined) return { output: 'success' };

    // meta arg is unused by finalizeKmWarArmy (marker only)
    const acc = (state.output ?? {}) as unknown as KmWarArmyOutput;
    const assembled = finalizeKmWarArmy(c, acc, acc, acc, { __km_war_army_meta_marked: true }, $);
    void target;

    setConceptOutput(state, assembled);

    return { output: 'success' };
  },
};

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
  discriminator: { _type: 'km-war-army' },
};
