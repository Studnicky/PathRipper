//
// Vehicles.aspx pages document piloted transports with body-resident stat-block
// fields, piloting checks, and operator action definitions.
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
  getField,
  asInt,
  htmlToText,
  splitTopLevel,
  extractEntityId,
  extractMetaDescription,
  extractMetaKeywords,
  stripStructuredKeys,
} from '../common.js';

// ─── Output type ─────────────────────────────────────────────────────────────

/** Piloting check option — one of several skills usable to control a vehicle. */
export interface VehiclePilotingCheck {
  /** Skill name (e.g. "Arcana", "Piloting Lore"). */
  skill: string;
  /** Piloting DC for this skill option. */
  dc:    number | null;
}

/** Operator action available while piloting/crewing the vehicle. */
export interface VehicleOperatorAction {
  /** Action label as displayed (e.g. "Drive", "Sail", "Sluggish"). */
  name:        string;
  /** Action cost glyph (`[one-action]` etc.) when the action carries one. */
  action_cost: string | null;
  /** Free-form action body text. */
  text:        string;
}

export interface VehicleOutput {
  url:              string;
  /** Numeric AON Vehicles.aspx ID extracted from the URL query string. */
  vehicle_id:       number | null;
  name:             string;
  /** Item-level marker parsed from the right-floated `Vehicle N` token. */
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
  /** Verbatim Price field text — em-dash → null. */
  price:            string | null;
  /** Verbatim Space field text — e.g. "90 feet long, 30 feet wide, 60 feet high". */
  space:            string | null;
  /** Verbatim Crew field text — e.g. "1 pilot, 5 other crew". */
  crew:             string | null;
  /** Verbatim Passengers field text. */
  passengers:       string | null;
  /** Piloting check options (skill + DC) from the Piloting Check field. */
  piloting_checks:  VehiclePilotingCheck[];
  /** Armor Class. */
  ac:               number | null;
  /** Fortitude save modifier. */
  fort:             number | null;
  /** Reflex save modifier (some vehicles lack one). */
  ref:              number | null;
  /** Hardness rating. */
  hardness:         number | null;
  /** Hit points (the leading integer; broken threshold captured separately). */
  hp:               number | null;
  /** Broken threshold from `HP N (BT M)` rendering. */
  broken_threshold: number | null;
  /** Immunities, comma-separated raw value. */
  immunities:       string | null;
  /** Weaknesses, comma-separated raw value. */
  weaknesses:       string | null;
  /** Verbatim Speed field text. */
  speed:            string | null;
  /** Verbatim Collision field text — e.g. "9d10 (DC 30)". */
  collision:        string | null;

  // ─── Operation ─────────────────────────────────────────────────────────────
  /** Operator actions defined in the body prose (Drive, Sail, Sluggish, …). */
  operator_actions: VehicleOperatorAction[];
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

/** Fields owned by `extract-vehicle-base`. */
export interface VehicleBaseSlice {
  url:             string;
  vehicle_id:      number | null;
  name:            string;
  level:           number | null;
  rarity:          Rarity;
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;
  traits:          string[];
  trait_ids:       Record<string, number>;
  source:          VehicleOutput['source'];
  sources:         SourceRef[];
}

/** Fields owned by `extract-vehicle-mechanics`. */
export interface VehicleMechanicsSlice {
  price:            string | null;
  space:            string | null;
  crew:             string | null;
  passengers:       string | null;
  piloting_checks:  VehiclePilotingCheck[];
  ac:               number | null;
  fort:             number | null;
  ref:              number | null;
  hardness:         number | null;
  hp:               number | null;
  broken_threshold: number | null;
  immunities:       string | null;
  weaknesses:       string | null;
  speed:            string | null;
  collision:        string | null;
}

/** Fields owned by `extract-vehicle-operation`. */
export interface VehicleOperationSlice {
  operator_actions: VehicleOperatorAction[];
  description_html: string;
  description_text: string;
}

/** Fields owned by `extract-vehicle-meta`. */
export interface VehicleMetaSlice {
  /** Marker so `state.output` accumulates the slice. */
  __vehicle_meta_marked: true;
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
 * Parse the Piloting Check field — a free-form list of `Skill (DC N)` entries
 * joined by `,` or ` or `. Skills may be ordinary skill names or `Piloting Lore`
 * style multi-word forms.
 */
function parsePilotingChecks(raw: string | null): VehiclePilotingCheck[] {
  if (raw === null || isDash(raw)) return [];
  const out: VehiclePilotingCheck[] = [];
  // Split on commas and ' or ' boundaries at depth 0.
  const normalized = raw.replace(/\s+or\s+/gi, ', ');
  for (const part of splitTopLevel(normalized, ',')) {
    const m = /^(.*?)\s*\(\s*DC\s+(\d+)\s*\)\s*$/i.exec(part.trim());
    if (m === null) {
      const skill = part.trim();
      if (skill !== '') out.push({ skill, dc: null });
      continue;
    }
    const skill = (m[1] ?? '').trim();
    const dc    = parseInt(m[2]!, 10);
    if (skill === '') continue;
    out.push({ skill, dc: Number.isFinite(dc) ? dc : null });
  }
  return out;
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

/**
 * Walk the body HTML extracting `<b>Name</b> [glyph]? text` operator-action
 * definitions, skipping any label in {@link STAT_BLOCK_LABELS}. AON renders
 * vehicle operations as a flat sequence of bold-label action stubs interleaved
 * with stat-block lines; classifying by label name is more robust than trying
 * to locate the `<hr />` boundary between stat-block and operator section
 * (some vehicles render operator actions inline with no separator).
 */
function parseOperatorActions(bodyHtml: string): VehicleOperatorAction[] {
  const out: VehicleOperatorAction[] = [];
  const labelRe = /<b>\s*([^<]+?)\s*<\/b>([\s\S]*?)(?=<b>|<h[1-3]\b|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = labelRe.exec(bodyHtml)) !== null) {
    const name = (m[1] ?? '').replace(/:$/, '').trim();
    if (name === '') continue;
    if (STAT_BLOCK_LABELS.has(name.toLowerCase())) continue;
    const valueHtml = m[2] ?? '';
    const glyphMatch = ACTION_GLYPH_RE.exec(valueHtml);
    let action_cost: string | null = null;
    if (glyphMatch !== null) {
      const inner = glyphMatch[1] ?? '';
      const lm = /\[([a-z-]+)\]/i.exec(inner);
      if (lm !== null) action_cost = (lm[1] ?? '').toLowerCase();
    }
    const text = htmlToText(valueHtml);
    if (text === '') continue;
    out.push({ name, action_cost, text });
  }
  return out;
}

/** Stat-block label set — these are scalar mechanics fields rather than
 *  operator actions. Anything else encountered after these in the body is
 *  treated as an operator action by {@link parseOperatorActions}. */
const STAT_BLOCK_LABELS: ReadonlySet<string> = new Set([
  'price', 'space', 'crew', 'passengers', 'piloting check',
  'ac', 'fort', 'ref', 'hardness', 'hp', 'bt',
  'immunities', 'weaknesses', 'speed', 'collision',
]);

/**
 * Harvest `<b>Label</b> Value` pairs from the body HTML for vehicle pages,
 * where most stat-block fields live in the body rather than the header.
 *
 * Returns a case-insensitive map keyed by lowercased label. `<hr />` and `<br />`
 * separators are treated as field boundaries; values are flattened to text.
 */
function harvestBodyFields(bodyHtml: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /<b>\s*([^<]+?)\s*<\/b>([\s\S]*?)(?=<b>|<hr|<h[1-6]\b|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bodyHtml)) !== null) {
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

/**
 * Slice description prose from the body. Description sits BEFORE the first
 * `<b>Label</b>` of any kind. Vehicle bodies typically open immediately with
 * a stat-block label (Space/AC/HP/etc.), in which case description is empty.
 */
function buildDescription(bodyHtml: string): { html: string; text: string; tail: string } {
  const firstBoldIdx = bodyHtml.search(/<b>/i);
  if (firstBoldIdx === -1) {
    return { html: bodyHtml.trim(), text: htmlToText(bodyHtml), tail: '' };
  }
  const lead = bodyHtml.slice(0, firstBoldIdx);
  const cleaned = lead.replace(/<hr\s*\/?>\s*$/i, '').trim();
  return {
    html: cleaned,
    text: htmlToText(cleaned),
    tail: bodyHtml.slice(firstBoldIdx),
  };
}

// ─── Per-slice extraction helpers ─────────────────────────────────────────────

/** Extract base identity + header scalars for a vehicle page. */
export function extractVehicleBase(c: CommonExtraction): VehicleBaseSlice {
  return {
    url:             c.url,
    vehicle_id:      extractEntityId(c.url),
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

/** Extract mechanical stat-block fields (defense, movement, crew, piloting).
 *  Vehicle pages keep most labels in the body HTML rather than the header
 *  `field_map`, so we harvest body fields as a fallback. */
export function extractVehicleMechanics(c: CommonExtraction): VehicleMechanicsSlice {
  const bodyFields = harvestBodyFields(c.body_html);
  const hpBt = parseHpBt(readField(c, bodyFields, 'HP'));
  return {
    price:            dashToNull(readField(c, bodyFields, 'Price')),
    space:            dashToNull(readField(c, bodyFields, 'Space')),
    crew:             dashToNull(readField(c, bodyFields, 'Crew')),
    passengers:       dashToNull(readField(c, bodyFields, 'Passengers')),
    piloting_checks:  parsePilotingChecks(readField(c, bodyFields, 'Piloting Check')),
    ac:               asInt(dashToNull(readField(c, bodyFields, 'AC'))),
    fort:             asInt(dashToNull(readField(c, bodyFields, 'Fort'))),
    ref:              asInt(dashToNull(readField(c, bodyFields, 'Ref'))),
    hardness:         asInt(dashToNull(readField(c, bodyFields, 'Hardness'))),
    hp:               hpBt.hp,
    broken_threshold: hpBt.broken_threshold,
    immunities:       dashToNull(readField(c, bodyFields, 'Immunities')),
    weaknesses:       dashToNull(readField(c, bodyFields, 'Weaknesses')),
    speed:            dashToNull(readField(c, bodyFields, 'Speed')),
    collision:        dashToNull(readField(c, bodyFields, 'Collision')),
  };
}

/** Extract operator actions and the description prose. */
export function extractVehicleOperation(c: CommonExtraction): VehicleOperationSlice {
  const desc = buildDescription(c.body_html);
  return {
    operator_actions: parseOperatorActions(c.body_html),
    description_html: desc.html,
    description_text: desc.text,
  };
}

/** Extract vehicle meta slice marker. */
export function extractVehicleMeta(_c: CommonExtraction): VehicleMetaSlice {
  return { __vehicle_meta_marked: true };
}

// ─── Finalize ────────────────────────────────────────────────────────────────

/** AON labels claimed by the vehicle slices (stripped from raw_fields). */
const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Source',
  'Price', 'Space', 'Crew', 'Passengers', 'Piloting Check',
  'AC', 'Fort', 'Ref', 'Hardness', 'HP', 'BT', 'Immunities', 'Weaknesses',
  'Speed', 'Collision',
];

export function finalizeVehicle(
  c:          CommonExtraction,
  base:       VehicleBaseSlice,
  mechanics:  VehicleMechanicsSlice,
  operation:  VehicleOperationSlice,
  _meta:      VehicleMetaSlice,
  $:          CheerioAPI,
): VehicleOutput {
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
  } satisfies VehicleOutput;
}

/**
 * Project a Vehicles.aspx page into a typed VehicleOutput.
 *
 * Thin assembly wrapper kept for `parseAonHtml` direct-call paths and unit
 * tests. The DAG pipeline calls the per-slice helpers individually through
 * the decomposed vehicle extraction nodes.
 */
export function extractVehicle(
  c:      CommonExtraction,
  $:      CheerioAPI,
  _span:  CheerioNode,
): VehicleOutput {
  void _span;
  const base      = extractVehicleBase(c);
  const mechanics = extractVehicleMechanics(c);
  const operation = extractVehicleOperation(c);
  const meta      = extractVehicleMeta(c);
  return finalizeVehicle(c, base, mechanics, operation, meta, $);
}

// Re-export output types so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

export type VehicleBaseOutput = 'success' | 'error';

export const vehicleBaseNode: NodeInterface<ScrapeState, VehicleBaseOutput, RipperServices> = {
  name:    'extract:vehicle-base',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: VehicleBaseOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const base = extractVehicleBase(c);

    state.output = { ...state.output, ...base };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type VehicleMechanicsOutput = 'success' | 'error';

export const vehicleMechanicsNode: NodeInterface<ScrapeState, VehicleMechanicsOutput, RipperServices> = {
  name:    'extract:vehicle-mechanics',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: VehicleMechanicsOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const mechanics = extractVehicleMechanics(c);

    state.output = { ...state.output, ...mechanics };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeVehicleOutput = 'success';

export const finalizeVehicleNode: NodeInterface<ScrapeState, FinalizeVehicleOutput, RipperServices> = {
  name:    'finalize:vehicle',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FinalizeVehicleOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $ = state.getMetadata<CheerioAPI>('aonprdCheerio');
    if (c === undefined || $ === undefined) return { output: 'success' };
    const acc = (state.output ?? {}) as unknown as VehicleOutput;
    const operation = extractVehicleOperation(c);
    const meta      = extractVehicleMeta(c);
    const assembled = finalizeVehicle(c, acc, acc, operation, meta, $);
    setConceptOutput(state, assembled);

    return { output: 'success' };
  },
};

// ─── ConceptDecl export ───────────────────────────────────────────────────────

export const vehicleConcept: ConceptDecl<VehicleOutput> = {
  id:       'vehicle',
  parent:   'entity',
  urlPaths: ['vehicles'],
  capabilities: [
    vehicleBaseNode,
    vehicleMechanicsNode,
    finalizeVehicleNode,
  ],
};
