//
// Vehicles.aspx pages document piloted transports with body-resident stat-block
// fields, piloting checks, and operator action definitions.
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
  const trimmed = value.trim();
  return trimmed === '' || DASH_RE.test(trimmed);
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
    const match = /^(.*?)\s*\(\s*DC\s+(\d+)\s*\)\s*$/i.exec(part.trim());
    if (match === null) {
      const skill = part.trim();
      if (skill !== '') out.push({ skill, dc: null });
      continue;
    }
    const skill   = (match[1] ?? '').trim();
    const dcValue = parseInt(match[2]!, 10);
    if (skill === '') continue;
    out.push({ skill, dc: Number.isFinite(dcValue) ? dcValue : null });
  }
  return out;
}

/**
 * Parse `HP N (BT M)` rendering into separate HP and broken-threshold ints.
 * Em-dash → both null. Missing BT → broken_threshold null.
 */
function parseHpBt(raw: string | null): { hp: number | null; broken_threshold: number | null } {
  if (raw === null || isDash(raw)) return { hp: null, broken_threshold: null };
  const trimmed = raw.trim();
  const match = /^(-?\d+)(?:\s*\(\s*BT\s+(-?\d+)\s*\))?/i.exec(trimmed);
  if (match === null) return { hp: null, broken_threshold: null };
  const hpNum = parseInt(match[1]!, 10);
  const btNum = match[2] !== undefined ? parseInt(match[2], 10) : null;
  return {
    hp:               Number.isFinite(hpNum) ? hpNum : null,
    broken_threshold: btNum !== null && Number.isFinite(btNum) ? btNum : null,
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
  let match: RegExpExecArray | null;
  while ((match = labelRe.exec(bodyHtml)) !== null) {
    const name = (match[1] ?? '').replace(/:$/, '').trim();
    if (name === '') continue;
    if (STAT_BLOCK_LABELS.has(name.toLowerCase())) continue;
    const valueHtml = match[2] ?? '';
    const glyphMatch = ACTION_GLYPH_RE.exec(valueHtml);
    let action_cost: string | null = null;
    if (glyphMatch !== null) {
      const inner = glyphMatch[1] ?? '';
      const lastMatch = /\[([a-z-]+)\]/i.exec(inner);
      if (lastMatch !== null) action_cost = (lastMatch[1] ?? '').toLowerCase();
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
  const regex = /<b>\s*([^<]+?)\s*<\/b>([\s\S]*?)(?=<b>|<hr|<h[1-6]\b|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(bodyHtml)) !== null) {
    const labelRaw = match[1] ?? '';
    const valueHtml = match[2] ?? '';
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
  common: CommonExtraction,
  bodyFields: Map<string, string>,
  label: string,
): string | null {
  const fromHead = getField(common, label);
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
export function extractVehicleBase(common: CommonExtraction): VehicleBaseSlice {
  return {
    url:             common.url,
    vehicle_id:      extractEntityId(common.url),
    name:            common.title.name,
    level:           common.title.level,
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

/** Extract mechanical stat-block fields (defense, movement, crew, piloting).
 *  Vehicle pages keep most labels in the body HTML rather than the header
 *  `field_map`, so we harvest body fields as a fallback. */
export function extractVehicleMechanics(common: CommonExtraction): VehicleMechanicsSlice {
  const bodyFields = harvestBodyFields(common.body_html);
  const hpBt = parseHpBt(readField(common, bodyFields, 'HP'));
  return {
    price:            dashToNull(readField(common, bodyFields, 'Price')),
    space:            dashToNull(readField(common, bodyFields, 'Space')),
    crew:             dashToNull(readField(common, bodyFields, 'Crew')),
    passengers:       dashToNull(readField(common, bodyFields, 'Passengers')),
    piloting_checks:  parsePilotingChecks(readField(common, bodyFields, 'Piloting Check')),
    ac:               asInt(dashToNull(readField(common, bodyFields, 'AC'))),
    fort:             asInt(dashToNull(readField(common, bodyFields, 'Fort'))),
    ref:              asInt(dashToNull(readField(common, bodyFields, 'Ref'))),
    hardness:         asInt(dashToNull(readField(common, bodyFields, 'Hardness'))),
    hp:               hpBt.hp,
    broken_threshold: hpBt.broken_threshold,
    immunities:       dashToNull(readField(common, bodyFields, 'Immunities')),
    weaknesses:       dashToNull(readField(common, bodyFields, 'Weaknesses')),
    speed:            dashToNull(readField(common, bodyFields, 'Speed')),
    collision:        dashToNull(readField(common, bodyFields, 'Collision')),
  };
}

/** Extract operator actions and the description prose. */
export function extractVehicleOperation(common: CommonExtraction): VehicleOperationSlice {
  const desc = buildDescription(common.body_html);
  return {
    operator_actions: parseOperatorActions(common.body_html),
    description_html: desc.html,
    description_text: desc.text,
  };
}

/** Extract vehicle meta slice marker. */
export function extractVehicleMeta(_common: CommonExtraction): VehicleMetaSlice {
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
  common:     CommonExtraction,
  base:       VehicleBaseSlice,
  mechanics:  VehicleMechanicsSlice,
  operation:  VehicleOperationSlice,
  _meta:      VehicleMetaSlice,
  root:       CheerioAPI,
): VehicleOutput {
  void _meta;
  const raw_fields = stripStructuredKeys(common.field_map, CLAIMED_FIELD_LABELS);
  return {
    ...base,
    ...mechanics,
    ...operation,
    sections:         common.sections,
    raw_fields,
    links:            common.links,
    body_text:        common.body_text,
    body_html:        common.body_html,
    meta_description: extractMetaDescription(root),
    meta_keywords:    extractMetaKeywords(root),
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
  common: CommonExtraction,
  root:   CheerioAPI,
  _span:  CheerioNode,
): VehicleOutput {
  void _span;
  const base      = extractVehicleBase(common);
  const mechanics = extractVehicleMechanics(common);
  const operation = extractVehicleOperation(common);
  const meta      = extractVehicleMeta(common);
  return finalizeVehicle(common, base, mechanics, operation, meta, root);
}

// Re-export output types so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

export type VehicleBaseOutput = 'success' | 'error';

class VehicleBaseNodeImpl extends ScalarNode<ScrapeState, VehicleBaseOutput> {
  public readonly name = 'extract:vehicle-base';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<'success' | 'error', SchemaObjectType> {
    return {
      // `success` — state.output merged with VehicleBaseSlice (url, vehicle_id, name, level, rarity, pfs, legacy, alt_edition_url, traits, trait_ids, source, sources)
      success: { type: 'object' },
      error:   { type: 'object' },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<VehicleBaseOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const base = extractVehicleBase(common);

    state.output = { ...state.output, ...base };

    return NodeOutputBuilder.of('success');
  }
}
export const vehicleBaseNode = new VehicleBaseNodeImpl();

// ─────────────────────────────────────────────────────────────────────────────

export type VehicleMechanicsOutput = 'success' | 'error';

class VehicleMechanicsNodeImpl extends ScalarNode<ScrapeState, VehicleMechanicsOutput> {
  public readonly name = 'extract:vehicle-mechanics';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<'success' | 'error', SchemaObjectType> {
    return {
      // `success` — state.output merged with VehicleMechanicsSlice (price, space, crew, passengers, piloting_checks, ac, fort, ref, hardness, hp, broken_threshold, immunities, weaknesses, speed, collision)
      success: { type: 'object' },
      error:   { type: 'object' },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<VehicleMechanicsOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const mechanics = extractVehicleMechanics(common);

    state.output = { ...state.output, ...mechanics };

    return NodeOutputBuilder.of('success');
  }
}
export const vehicleMechanicsNode = new VehicleMechanicsNodeImpl();

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeVehicleOutput = 'success';

class FinalizeVehicleNodeImpl extends ScalarNode<ScrapeState, FinalizeVehicleOutput> {
  public readonly name = 'finalize:vehicle';
  public readonly outputs = ['success'] as const;

  public override get outputSchema(): Record<'success', SchemaObjectType> {
    return {
      // `success` — state.output set to full VehicleOutput via setConceptOutput
      success: {
        type: 'object',
        properties: {
          output: { type: 'object' },
        },
        required: ['output'],
      },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<FinalizeVehicleOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root   = state.getMetadata<CheerioAPI>('aonprdCheerio');
    if (common === undefined || root === undefined) return NodeOutputBuilder.of('success');
    const acc = (state.output ?? {}) as unknown as VehicleOutput;
    const operation = extractVehicleOperation(common);
    const meta      = extractVehicleMeta(common);
    const assembled = finalizeVehicle(common, acc, acc, operation, meta, root);
    setConceptOutput(state, assembled);

    return NodeOutputBuilder.of('success');
  }
}
export const finalizeVehicleNode = new FinalizeVehicleNodeImpl();

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
