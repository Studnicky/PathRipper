//
// SiegeWeapons.aspx pages document large ranged engines with body-resident
// stat-block fields and operator action definitions.
import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';
import { load, type CheerioAPI } from 'cheerio';

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
  getField,
  asInt,
  htmlToText,
  extractEntityId,
  extractMetaDescription,
  extractMetaKeywords,
  stripStructuredKeys,
} from '../common.js';

// ─── Output type ─────────────────────────────────────────────────────────────

/** Ammunition entry parsed from the `Ammunition` field. */
export interface SiegeWeaponAmmunition {
  /** Display name of the ammunition (e.g. "nine-barrel block"). */
  name:  string;
  /** Cost in gp (when stated). */
  price: string | null;
  /** Bulk descriptor (e.g. "L", "1"). */
  bulk:  string | null;
  /** Verbatim raw text. */
  raw:   string;
}

/** Operator action available while crewing a siege weapon. */
export interface SiegeWeaponOperatorAction {
  /** Action label (Aim, Load, Fire, Launch, Reload, …). */
  name:        string;
  /** Action cost glyph (`one-action`/`two-actions`/`three-actions`/`reaction`). */
  action_cost: string | null;
  /** Components in trailing `(component, …)` parens. */
  components:  string[];
  /** Free-form action body text. */
  text:        string;
}

export interface SiegeWeaponOutput {
  url:              string;
  /** Numeric AON SiegeWeapons.aspx ID extracted from the URL query string. */
  siege_weapon_id:  number | null;
  name:             string;
  /** Item-level marker parsed from the right-floated `Item N` token. */
  level:            number | null;
  rarity:           Rarity;
  pfs:              PfsLegality | null;
  legacy:           boolean;
  alt_edition_url:  string | null;
  traits:           string[];
  trait_ids:        Record<string, number>;
  source:           { book: string | null; page: number | null; source_id: number | null };
  sources:          SourceRef[];

  // ─── Mechanics ─────────────────────────────────────────────────────────────
  /** Verbatim Price field text. */
  price:            string | null;
  /** Parsed ammunition entry, when the page carries an Ammunition label. */
  ammunition:       SiegeWeaponAmmunition | null;
  /** Verbatim Usage field text (e.g. "mounted (black powder)"). */
  usage:            string | null;
  /** Verbatim Space field text. */
  space:            string | null;
  /** Verbatim Crew field text — e.g. "1 to 3". */
  crew:             string | null;
  /** Proficiency category — martial/advanced. */
  proficiency:      string | null;
  /** Armor Class. */
  ac:               number | null;
  /** Fortitude save modifier. */
  fort:             number | null;
  /** Reflex save modifier. */
  ref:              number | null;
  /** Hardness rating. */
  hardness:         number | null;
  /** Hit points (leading integer; broken threshold captured separately). */
  hp:               number | null;
  /** Broken threshold from `HP N (BT M)` rendering. */
  broken_threshold: number | null;
  /** Immunities, raw value. */
  immunities:       string | null;
  /** Verbatim Speed field text — e.g. "20 feet (pulled or pushed)". */
  speed:            string | null;

  // ─── Operation ─────────────────────────────────────────────────────────────
  /** Operator actions from the body prose. */
  operator_actions: SiegeWeaponOperatorAction[];
  description_html: string;
  description_text: string;

  // ─── Bookkeeping ───────────────────────────────────────────────────────────
  sections:         Section[];
  raw_fields:       Record<string, string>;
  links:            LinkRef[];
  body_text:        string;
  body_html:        string;
  meta_description: string | null;
  meta_keywords:    string | null;
}

// ─── Per-node slice types ─────────────────────────────────────────────────────

export interface SiegeWeaponBaseSlice {
  url:             string;
  siege_weapon_id: number | null;
  name:            string;
  level:           number | null;
  rarity:          Rarity;
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;
  traits:          string[];
  trait_ids:       Record<string, number>;
  source:          SiegeWeaponOutput['source'];
  sources:         SourceRef[];
}

export interface SiegeWeaponMechanicsSlice {
  price:            string | null;
  ammunition:       SiegeWeaponAmmunition | null;
  usage:            string | null;
  space:            string | null;
  crew:             string | null;
  proficiency:      string | null;
  ac:               number | null;
  fort:             number | null;
  ref:              number | null;
  hardness:         number | null;
  hp:               number | null;
  broken_threshold: number | null;
  immunities:       string | null;
  speed:            string | null;
}

export interface SiegeWeaponOperationSlice {
  operator_actions: SiegeWeaponOperatorAction[];
  description_html: string;
  description_text: string;
}

export interface SiegeWeaponMetaSlice {
  __siege_weapon_meta_marked: true;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DASH_RE = /^(?:—|–|-|&mdash;|&ndash;)$/;

function isDash(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  const t = value.trim();
  return t === '' || DASH_RE.test(t);
}

function dashToNull(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed === '' || DASH_RE.test(trimmed)) return null;
  return trimmed;
}

/**
 * Parse `Ammunition` field into a structured entry. AON renders this as:
 *   `nine-barrel block (5 gp, L Bulk)`
 * with the name preceding optional parenthesised price/bulk metadata. Em-dash → null.
 */
function parseAmmunition(raw: string | null): SiegeWeaponAmmunition | null {
  if (raw === null || isDash(raw)) return null;
  const t = raw.trim();
  const parenMatch = /^([^()]+?)\s*\(([^()]+)\)\s*$/.exec(t);
  if (parenMatch === null) {
    return { name: t, price: null, bulk: null, raw: t };
  }
  const name = (parenMatch[1] ?? '').trim();
  const meta = (parenMatch[2] ?? '').trim();
  let price: string | null = null;
  let bulk:  string | null = null;
  for (const part of meta.split(',').map((s) => s.trim())) {
    if (part === '') continue;
    if (/\b(gp|sp|cp)\b/i.test(part)) price = part;
    else if (/\bbulk\b/i.test(part) || /^L$/i.test(part) || /^\d+$/.test(part)) bulk = part;
  }
  return { name, price, bulk, raw: t };
}

/**
 * Parse `HP N (BT M)` rendering into separate HP and broken-threshold ints.
 * Em-dash → both null. Missing BT → broken_threshold null.
 */
function parseHpBt(raw: string | null): { hp: number | null; broken_threshold: number | null } {
  if (raw === null || isDash(raw)) return { hp: null, broken_threshold: null };
  const t = raw.trim();
  const m = /^(-?\d+)(?:\s*\(\s*BT\s+(-?\d+)\s*\))?/i.exec(t);
  if (m === null) return { hp: null, broken_threshold: null };
  const hp = parseInt(m[1]!, 10);
  const bt = m[2] !== undefined ? parseInt(m[2], 10) : null;
  return {
    hp:               Number.isFinite(hp) ? hp : null,
    broken_threshold: bt !== null && Number.isFinite(bt) ? bt : null,
  };
}

const ACTION_GLYPH_RE = /<span\s+class=['"]action['"][^>]*>([\s\S]*?)<\/span>/i;

/** Stat-block labels (treated as scalar mechanics, not operator actions). */
const STAT_BLOCK_LABELS: ReadonlySet<string> = new Set([
  'price', 'ammunition', 'usage', 'space', 'crew', 'proficiency',
  'ac', 'fort', 'ref', 'hardness', 'hp', 'bt', 'immunities', 'speed',
]);

/**
 * Walk body HTML, extracting operator-action stubs of the form:
 *   `<b>Name</b> <span class='action'>[glyph]</span>? (components,…)? body`
 * AON renders these as a flat list after the prose. Each operator action ends
 * at the next `<b>` (the next action label) or the end of the body fragment.
 * Labels in {@link STAT_BLOCK_LABELS} are skipped — those belong to the
 * mechanics slice rather than the operator-actions list.
 */
function parseOperatorActions(tailHtml: string): SiegeWeaponOperatorAction[] {
  const out: SiegeWeaponOperatorAction[] = [];
  const labelRe = /<b>\s*([^<]+?)\s*<\/b>([\s\S]*?)(?=<b>|<h[1-3]\b|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = labelRe.exec(tailHtml)) !== null) {
    const name = (m[1] ?? '').replace(/:$/, '').trim();
    if (name === '') continue;
    if (STAT_BLOCK_LABELS.has(name.toLowerCase())) continue;
    const valueHtml = m[2] ?? '';

    // Action cost glyph.
    const glyphMatch = ACTION_GLYPH_RE.exec(valueHtml);
    let action_cost: string | null = null;
    if (glyphMatch !== null) {
      const inner = glyphMatch[1] ?? '';
      const lm = /\[([a-z-]+)\]/i.exec(inner);
      if (lm !== null) action_cost = (lm[1] ?? '').toLowerCase();
    }

    // Component list from the first trailing `(…)` block in the text.
    const components: string[] = [];
    const textForComp = htmlToText(valueHtml.replace(/<span\s+class=['"]action['"][\s\S]*?<\/span>/gi, ''));
    const compMatch = /\(([^()]+)\)/.exec(textForComp);
    if (compMatch !== null) {
      for (const part of (compMatch[1] ?? '').split(',').map((s) => s.trim().toLowerCase())) {
        if (part !== '') components.push(part);
      }
    }

    const text = htmlToText(valueHtml);
    if (text === '') continue;
    out.push({ name, action_cost, components, text });
  }
  return out;
}

/** Slice description prose from the body up to the first operator-action stub. */
function buildDescription(bodyHtml: string): { html: string; text: string; tail: string } {
  // Siege-weapon body: stat-block `<hr />` blocks precede the Speed line, then
  // a final `<hr />` introduces description + operator actions. The first
  // `<b>` after the last `<hr />` marks the start of operator actions.
  const lastHr = bodyHtml.lastIndexOf('<hr');
  const startIdx = lastHr === -1 ? 0 : bodyHtml.indexOf('>', lastHr) + 1;
  const tail = bodyHtml.slice(startIdx);
  const firstB = tail.search(/<b>/i);
  if (firstB === -1) {
    return { html: tail.trim(), text: htmlToText(tail), tail };
  }
  const descHtml = tail.slice(0, firstB);
  return { html: descHtml.trim(), text: htmlToText(descHtml), tail: tail.slice(firstB) };
}

/**
 * Harvest `<b>Label</b> Value` pairs from the body HTML for siege-weapon
 * pages, where most stat-block fields live in the body rather than the header
 * (Usage/Space/Crew/Proficiency/AC/Fort/Ref/Hardness/HP/Immunities/Speed).
 *
 * Returns a case-insensitive map; reading stops at the prose tail (the
 * description begins where the first `<b>Name</b>` is followed by an action
 * glyph or no `<hr />` separator).
 */
function harvestBodyFields(bodyHtml: string): Map<string, string> {
  // Trim the body to the stat-block region (before the description + operator
  // actions). The stat block consists of `<b>Label</b> Value` pairs separated
  // by `<br>` and `<hr>`, terminated by the final `<hr />` before the prose.
  const lastHr = bodyHtml.lastIndexOf('<hr');
  const head   = lastHr === -1 ? bodyHtml : bodyHtml.slice(0, lastHr);
  const out = new Map<string, string>();
  // Each pair: `<b>Label</b> Value` up to the next `<b>` or end. Stop also at
  // `<hr>` since they're field boundaries.
  const re = /<b>\s*([^<]+?)\s*<\/b>([\s\S]*?)(?=<b>|<hr|<h[1-6]\b|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(head)) !== null) {
    const labelRaw = m[1] ?? '';
    const valueHtml = m[2] ?? '';
    const label = labelRaw.replace(/:$/, '').trim();
    if (label === '') continue;
    if (/^source$/i.test(label)) continue;
    const value = htmlToText(valueHtml).replace(/[;,]\s*$/, '').trim();
    if (value === '') continue;
    const key = label.toLowerCase();
    if (!out.has(key)) out.set(key, value);
  }
  return out;
}

/** Read a label from `field_map` first, falling back to a body-fields map. */
function readField(
  c: CommonExtraction,
  bodyFields: Map<string, string>,
  label: string,
): string | null {
  const fromHead = getField(c, label);
  if (fromHead !== null) return fromHead;
  return bodyFields.get(label.toLowerCase()) ?? null;
}

// ─── Per-slice extraction helpers ─────────────────────────────────────────────

/** Extract base identity + header scalars for a siege weapon page. */
export function extractSiegeWeaponBase(c: CommonExtraction): SiegeWeaponBaseSlice {
  return {
    url:             c.url,
    siege_weapon_id: extractEntityId(c.url),
    name:            c.title.name,
    level:           c.title.level,
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

/** Extract mechanical stat-block fields. Siege-weapon pages keep most labels
 *  in the body HTML rather than the header `field_map`, so we harvest body
 *  fields as a fallback. */
export function extractSiegeWeaponMechanics(c: CommonExtraction): SiegeWeaponMechanicsSlice {
  const bodyFields = harvestBodyFields(c.body_html);
  const hpBt = parseHpBt(readField(c, bodyFields, 'HP'));
  return {
    price:            dashToNull(readField(c, bodyFields, 'Price')),
    ammunition:       parseAmmunition(readField(c, bodyFields, 'Ammunition')),
    usage:            dashToNull(readField(c, bodyFields, 'Usage')),
    space:            dashToNull(readField(c, bodyFields, 'Space')),
    crew:             dashToNull(readField(c, bodyFields, 'Crew')),
    proficiency:      dashToNull(readField(c, bodyFields, 'Proficiency')),
    ac:               asInt(dashToNull(readField(c, bodyFields, 'AC'))),
    fort:             asInt(dashToNull(readField(c, bodyFields, 'Fort'))),
    ref:              asInt(dashToNull(readField(c, bodyFields, 'Ref'))),
    hardness:         asInt(dashToNull(readField(c, bodyFields, 'Hardness'))),
    hp:               hpBt.hp,
    broken_threshold: hpBt.broken_threshold,
    immunities:       dashToNull(readField(c, bodyFields, 'Immunities')),
    speed:            dashToNull(readField(c, bodyFields, 'Speed')),
  };
}

/** Extract operator actions and description prose. */
export function extractSiegeWeaponOperation(c: CommonExtraction): SiegeWeaponOperationSlice {
  const desc = buildDescription(c.body_html);
  return {
    operator_actions: parseOperatorActions(c.body_html),
    description_html: desc.html,
    description_text: desc.text,
  };
}

/** Extract meta slice marker. */
export function extractSiegeWeaponMeta(_c: CommonExtraction): SiegeWeaponMetaSlice {
  return { __siege_weapon_meta_marked: true };
}

// ─── Finalize ────────────────────────────────────────────────────────────────

const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Source',
  'Price', 'Ammunition', 'Usage', 'Space', 'Crew', 'Proficiency',
  'AC', 'Fort', 'Ref', 'Hardness', 'HP', 'BT', 'Immunities', 'Speed',
];

export function finalizeSiegeWeapon(
  c:          CommonExtraction,
  base:       SiegeWeaponBaseSlice,
  mechanics:  SiegeWeaponMechanicsSlice,
  operation:  SiegeWeaponOperationSlice,
  _meta:      SiegeWeaponMetaSlice,
  $:          CheerioAPI,
): SiegeWeaponOutput {
  void _meta;
  const raw_fields = stripStructuredKeys(c.field_map, CLAIMED_FIELD_LABELS);
  return {
    ...base,
    ...mechanics,
    ...operation,
    sections:         c.sections,
    raw_fields,
    links:            c.links,
    body_text:        c.body_text,
    body_html:        c.body_html,
    meta_description: extractMetaDescription($),
    meta_keywords:    extractMetaKeywords($),
  } satisfies SiegeWeaponOutput;
}

/**
 * Project a SiegeWeapons.aspx page into a typed SiegeWeaponOutput.
 *
 * Thin assembly wrapper kept for `parseAonHtml` direct-call paths and unit
 * tests. The DAG pipeline calls the per-slice helpers individually through
 * the decomposed siege-weapon extraction nodes.
 */
export function extractSiegeWeapon(
  c:      CommonExtraction,
  $:      CheerioAPI,
  _span:  CheerioNode,
): SiegeWeaponOutput {
  void _span;
  const base      = extractSiegeWeaponBase(c);
  const mechanics = extractSiegeWeaponMechanics(c);
  const operation = extractSiegeWeaponOperation(c);
  const meta      = extractSiegeWeaponMeta(c);
  return finalizeSiegeWeapon(c, base, mechanics, operation, meta, $);
}

// Re-export output types so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

export type SiegeWeaponBaseOutput = 'success' | 'error';

export const siegeWeaponBaseNode: NodeInterface<ScrapeState, SiegeWeaponBaseOutput, RipperServices> = {
  name:    'extract:siege-weapon-base',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: SiegeWeaponBaseOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const base = extractSiegeWeaponBase(c);

    state.output = { ...state.output, ...base };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type SiegeWeaponMechanicsOutput = 'success' | 'error';

export const siegeWeaponMechanicsNode: NodeInterface<ScrapeState, SiegeWeaponMechanicsOutput, RipperServices> = {
  name:    'extract:siege-weapon-mechanics',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: SiegeWeaponMechanicsOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const mechanics = extractSiegeWeaponMechanics(c);

    state.output = { ...state.output, ...mechanics };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeSiegeWeaponOutput = 'success';

export const finalizeSiegeWeaponNode: NodeInterface<ScrapeState, FinalizeSiegeWeaponOutput, RipperServices> = {
  name:    'finalize:siege-weapon',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FinalizeSiegeWeaponOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $ = state.getMetadata<CheerioAPI>('aonprdCheerio');
    if (c === undefined || $ === undefined) return { output: 'success' };
    const acc = (state.output ?? {}) as unknown as SiegeWeaponOutput;
    const operation = extractSiegeWeaponOperation(c);
    const meta      = extractSiegeWeaponMeta(c);
    const assembled = finalizeSiegeWeapon(c, acc, acc, operation, meta, $);
    setConceptOutput(state, assembled);

    return { output: 'success' };
  },
};

// ─── ConceptDecl export ───────────────────────────────────────────────────────

export const siegeWeaponConcept: ConceptDecl<SiegeWeaponOutput> = {
  id:       'siege-weapon',
  parent:   'entity',
  urlPaths: ['siegeweapons'],
  capabilities: [
    siegeWeaponBaseNode,
    siegeWeaponMechanicsNode,
    finalizeSiegeWeaponNode,
  ],
};
