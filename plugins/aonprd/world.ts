// World-content extractors: condition, trait, hazard, deity, archetype.
// These pages range from minimal (condition: just Source + body) to complex
// (hazard: a full statblock). The shared foundation already harvests all label
// pairs and sections; here we add structured projection on top.
import type { CheerioAPI } from 'cheerio';
import {
  type CommonExtraction,
  type CheerioNode,
  type LinkRef,
  type Rarity,
  type PfsLegality,
  type Section,
  getField,
  asInt,
  splitTopLevel,
  htmlToText,
} from './common.js';

interface SourceShape { book: string | null; page: number | null; source_id: number | null }

interface BaseShape {
  url:             string;
  name:            string;
  rarity:          Rarity;
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;
  traits:          string[];
  source:          SourceShape;
  sections:        Section[];
  raw_fields:      Record<string, string>;
  links:           LinkRef[];
  body_text:       string;
  body_html:       string;
}

function baseFrom(c: CommonExtraction): BaseShape {
  return {
    url:             c.url,
    name:            c.title.name,
    rarity:          c.traits.rarity,
    pfs:             c.title.pfs,
    legacy:          c.title.legacy,
    alt_edition_url: c.title.alt_edition_url,
    traits:          c.traits.traits,
    source:          { book: c.source.book, page: c.source.page, source_id: c.source.source_id },
    sections:        c.sections,
    raw_fields:      { ...c.field_map },
    links:           c.links,
    body_text:       c.body_text,
    body_html:       c.body_html,
  };
}

// ─── Condition ────────────────────────────────────────────────────────────────

export interface ConditionStage {
  stage:     number;
  text:      string;
  duration:  string | null;
}

export interface ConditionOutput extends BaseShape {
  _type:    'condition';
  stages:   ConditionStage[];
  /** Other conditions referenced from the body. */
  related_conditions: Array<{ name: string; condition_id: number | null }>;
}

/** Detect inline `<b>Stage N</b>` markers in a condition body. */
function parseStages(html: string): ConditionStage[] {
  const re = /<b>\s*Stage\s*(\d+)\s*<\/b>\s*([\s\S]*?)(?=<b>\s*Stage\s*\d+\s*<\/b>|<hr|$)/gi;
  const out: ConditionStage[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const stage = parseInt(m[1] ?? '0', 10);
    const body = htmlToText(m[2] ?? '');
    const durMatch = /\(([^)]+(?:day|round|hour|minute)[^)]*)\)/i.exec(body);
    out.push({
      stage,
      text:     body,
      duration: durMatch !== null ? durMatch[1]!.trim() : null,
    });
  }
  return out;
}

/** Project a condition record. */
export function extractCondition(c: CommonExtraction, _$: CheerioAPI, _span: CheerioNode): ConditionOutput {
  void _$; void _span;
  const base = baseFrom(c);
  const stages = parseStages(c.body_html);
  const related_conditions = c.links
    .filter((l) => l.kind === 'Conditions')
    .map((l) => ({ name: l.text, condition_id: l.id }));
  return { _type: 'condition', ...base, stages, related_conditions };
}

// ─── Trait ────────────────────────────────────────────────────────────────────

export interface TraitOutput extends BaseShape {
  _type:    'trait';
  category: string | null;
}

/** Project a trait page. Body usually links to all members. */
export function extractTrait(c: CommonExtraction, _$: CheerioAPI, _span: CheerioNode): TraitOutput {
  void _$; void _span;
  const base = baseFrom(c);
  // AON includes the trait's filter category (e.g. weapon/spell/creature) only
  // implicitly via the listing page; we infer from inbound link kinds.
  const linkKinds = new Set(c.links.map((l) => l.kind));
  let category: string | null = null;
  if (linkKinds.has('Spells'))      category = 'spell';
  else if (linkKinds.has('Weapons')) category = 'weapon';
  else if (linkKinds.has('Monsters') || linkKinds.has('Creatures')) category = 'creature';
  return { _type: 'trait', ...base, category };
}

// ─── Hazard ───────────────────────────────────────────────────────────────────

export interface HazardComponent {
  component: string;
  value:     number;
  notes:     string | null;
  bt:        number | null;
}

export interface HazardRoutine {
  name:         string;
  trigger:      string | null;
  effect:       string;
  actions:      string | null;
}

export interface HazardOutput extends BaseShape {
  _type:        'hazard';
  level:        number | null;
  complexity:   'simple' | 'complex' | null;
  stealth:      { dc: number | null; notes: string | null; raw: string | null };
  description_text: string | null;
  disable:      Array<{ skill: string; dc: number | null; text: string }>;
  defenses: {
    ac:          number | null;
    saves:       { fort: number | null; ref: number | null; will: number | null };
    hardness:    HazardComponent[];
    hp:          HazardComponent[];
    immunities:  string[];
    weaknesses:  Array<{ type: string; value: number }>;
    resistances: Array<{ type: string; value: number; exceptions: string | null }>;
  };
  routines:     HazardRoutine[];
  reset:        string | null;
}

const KNOWN_HAZARD_LABELS = new Set<string>([
  'Source', 'Complexity', 'Stealth', 'Description', 'Disable',
  'AC', 'Fort', 'Ref', 'Will', 'Immunities', 'Weaknesses', 'Resistances', 'Hardness', 'HP',
  'Trigger', 'Effect', 'Reset', 'Routine',
]);

function parseStealth(value: string | null): { dc: number | null; notes: string | null; raw: string | null } {
  if (value === null) return { dc: null, notes: null, raw: null };
  const m = /DC\s*(\d+)\s*(.*)/i.exec(value);
  if (m === null) return { dc: null, notes: value, raw: value };
  const notes = (m[2] ?? '').trim();
  return { dc: parseInt(m[1]!, 10), notes: notes === '' ? null : notes, raw: value };
}

function parseDisable(value: string | null): Array<{ skill: string; dc: number | null; text: string }> {
  if (value === null) return [];
  // Pattern: "DC 15 Athletics (trained) to climb out, or DC 25 Acrobatics …"
  const out: Array<{ skill: string; dc: number | null; text: string }> = [];
  const parts = value.split(/,\s*or\s+|;\s*/);
  for (const p of parts) {
    const m = /DC\s*(\d+)\s+([A-Z][a-zA-Z\s]+?)(?:\s*\(|\s+to\s|$)/.exec(p);
    if (m === null) {
      out.push({ skill: '', dc: null, text: p.trim() });
      continue;
    }
    out.push({ skill: m[2]!.trim(), dc: parseInt(m[1]!, 10), text: p.trim() });
  }
  return out;
}

function parseWeaknesses(value: string | null): Array<{ type: string; value: number }> {
  if (value === null) return [];
  return splitTopLevel(value, ',').flatMap((part) => {
    const m = /^(.+?)\s+(\d+)$/.exec(part);
    if (m === null) return [];
    return [{ type: m[1]!.trim(), value: parseInt(m[2]!, 10) }];
  });
}

function parseResistances(value: string | null): Array<{ type: string; value: number; exceptions: string | null }> {
  if (value === null) return [];
  return splitTopLevel(value, ',').flatMap((part) => {
    const m = /^(.+?)\s+(\d+)\s*(?:\(except\s+(.+)\))?$/.exec(part);
    if (m === null) return [];
    return [{
      type:       m[1]!.trim(),
      value:      parseInt(m[2]!, 10),
      exceptions: m[3] !== undefined ? m[3].trim() : null,
    }];
  });
}

function parseHazardComponents(c: CommonExtraction, suffix: 'Hardness' | 'HP'): HazardComponent[] {
  // AON labels these as `<Component> Hardness`, `<Component> HP` — collect
  // every field whose label ends with the suffix.
  const out: HazardComponent[] = [];
  for (const f of c.fields) {
    const m = new RegExp(`^(.*?)\\s*${suffix}$`, 'i').exec(f.label);
    if (m === null) continue;
    const component = (m[1] ?? '').trim() || 'main';
    const value = asInt(f.value_text);
    if (value === null) continue;
    const btMatch = /\(BT\s*(\d+)\)/i.exec(f.value_text);
    const noteMatch = /\((.*?)\)/.exec(f.value_text);
    out.push({
      component,
      value,
      bt:    btMatch !== null ? parseInt(btMatch[1]!, 10) : null,
      notes: noteMatch !== null && btMatch === null ? noteMatch[1]!.trim() : null,
    });
  }
  return out;
}

function parseRoutines(c: CommonExtraction): HazardRoutine[] {
  // Any unknown `<b>Label</b>` field followed by Trigger/Effect siblings is a
  // routine. We scan c.fields and group labels we don't recognize.
  const out: HazardRoutine[] = [];
  let cur: HazardRoutine | null = null;
  for (const f of c.fields) {
    if (KNOWN_HAZARD_LABELS.has(f.label) || /Hardness$/.test(f.label) || /\bHP$/.test(f.label)) {
      if (f.label === 'Trigger' && cur !== null) cur.trigger = f.value_text;
      if (f.label === 'Effect'  && cur !== null) cur.effect  = f.value_text;
      if (f.label === 'Reset')                   continue;
      continue;
    }
    // New routine.
    cur = { name: f.label, trigger: null, effect: f.value_text, actions: null };
    out.push(cur);
  }
  return out;
}

/** Project a hazard record (statblock-dense). */
export function extractHazard(c: CommonExtraction, _$: CheerioAPI, _span: CheerioNode): HazardOutput {
  void _$; void _span;
  const base = baseFrom(c);

  const compRaw = (getField(c, 'Complexity') ?? '').toLowerCase();
  const complexity: 'simple' | 'complex' | null =
    compRaw === 'simple'  ? 'simple' :
    compRaw === 'complex' ? 'complex' : null;

  const defenses = {
    ac:    asInt(getField(c, 'AC')),
    saves: {
      fort: asInt(getField(c, 'Fort')),
      ref:  asInt(getField(c, 'Ref')),
      will: asInt(getField(c, 'Will')),
    },
    hardness:    parseHazardComponents(c, 'Hardness'),
    hp:          parseHazardComponents(c, 'HP'),
    immunities:  splitTopLevel(getField(c, 'Immunities') ?? '', ','),
    weaknesses:  parseWeaknesses(getField(c, 'Weaknesses')),
    resistances: parseResistances(getField(c, 'Resistances')),
  };

  return {
    _type:        'hazard',
    ...base,
    level:        c.title.level,
    complexity,
    stealth:      parseStealth(getField(c, 'Stealth')),
    description_text: getField(c, 'Description'),
    disable:      parseDisable(getField(c, 'Disable')),
    defenses,
    routines:     parseRoutines(c),
    reset:        getField(c, 'Reset'),
  };
}

// ─── Generic / Unknown ────────────────────────────────────────────────────────

export interface GenericOutput extends BaseShape {
  _type: 'generic';
  level: number | null;
  level_kind: string | null;
}

export interface UnknownOutput extends BaseShape {
  _type: 'unknown';
}

/** Generic fallback — preserves everything via the BaseShape catch-all. */
export function extractGeneric(c: CommonExtraction, _$: CheerioAPI, _span: CheerioNode): GenericOutput {
  void _$; void _span;
  return {
    _type:      'generic',
    ...baseFrom(c),
    level:      c.title.level,
    level_kind: c.title.level_kind,
  };
}

/** Last-ditch shape used when even the content span couldn't be located. */
export function makeUnknown(url: string): UnknownOutput {
  return {
    _type:           'unknown',
    url,
    name:            '',
    rarity:          'common',
    pfs:             null,
    legacy:          false,
    alt_edition_url: null,
    traits:          [],
    source:          { book: null, page: null, source_id: null },
    sections:        [],
    raw_fields:      {},
    links:           [],
    body_text:       '',
    body_html:       '',
  };
}
