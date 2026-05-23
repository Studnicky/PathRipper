// Generic/condition/trait/hazard parsing helpers.

import type { CommonExtraction } from '../../common.js';
import {
  htmlToText,
  getField,
  asInt,
  splitTopLevel,
} from '../../common.js';
import type {
  ConditionStage,
  HazardComponent,
  HazardRoutine,
} from './types.js';

// ─── Condition helpers ────────────────────────────────────────────────────────

/** Detect inline `<b>Stage N</b>` markers in a condition body. */
export function parseConditionStages(html: string): ConditionStage[] {
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

// ─── Hazard helpers ───────────────────────────────────────────────────────────

function parseStealth(value: string | null): { dc: number | null; notes: string | null; raw: string | null } {
  if (value === null) return { dc: null, notes: null, raw: null };
  const m = /DC\s*(\d+)\s*(.*)/i.exec(value);
  if (m === null) return { dc: null, notes: value, raw: value };
  const notes = (m[2] ?? '').trim();
  return { dc: parseInt(m[1]!, 10), notes: notes === '' ? null : notes, raw: value };
}

export function parseDisable(value: string | null): Array<{ skill: string; dc: number | null; text: string }> {
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

  // First try the header fields (older hazard pages or pages with hr separator).
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
  if (out.length > 0) return out;

  // Fallback: scan the body HTML for `<b>Hardness</b> N` or `<b>HP</b> N (BT M)`.
  // Modern hazard pages (post-remaster) put the statblock in the body section.
  const bodyHtml = c.body_html;
  const re = new RegExp(`<b>\\s*(?:([\\w ]+)\\s+)?${suffix}\\s*<\\/b>\\s*([^<;]+?)(?=<b>|;|<br|$)`, 'gi');
  let bm: RegExpExecArray | null;
  while ((bm = re.exec(bodyHtml)) !== null) {
    const component = (bm[1] ?? '').trim() || 'main';
    const raw = (bm[2] ?? '').trim();
    const value = asInt(raw);
    if (value === null) continue;
    const btMatch = /\(BT\s*(\d+)\)/i.exec(raw);
    const noteMatch = /\((.*?)\)/.exec(raw);
    out.push({
      component,
      value,
      bt:    btMatch !== null ? parseInt(btMatch[1]!, 10) : null,
      notes: noteMatch !== null && btMatch === null ? noteMatch[1]!.trim() : null,
    });
  }
  return out;
}

const KNOWN_HAZARD_LABELS = new Set<string>([
  'Source', 'Complexity', 'Stealth', 'Description', 'Disable',
  'AC', 'Fort', 'Ref', 'Will', 'Immunities', 'Weaknesses', 'Resistances', 'Hardness', 'HP',
  'Trigger', 'Effect', 'Reset', 'Routine',
]);

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

/**
 * Extract a labeled field from the body HTML when it doesn't appear in the header.
 * Hazard statblocks embed Disable, AC, saves, etc. in the body text after the <hr />.
 */
function getBodyField(bodyHtml: string, label: string): string | null {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<b>\\s*${escapedLabel}\\s*<\\/b>\\s*([\\s\\S]*?)(?=<b>|<h[1-6]|$)`, 'i');
  const m = re.exec(bodyHtml);
  if (m === null) return null;
  const text = htmlToText(m[1] ?? '');
  return text === '' ? null : text;
}

/** Convenience: header lookup with body-HTML fallback for label `name`. */
export function getHazardField(c: CommonExtraction, name: string): string | null {
  return getField(c, name) ?? getBodyField(c.body_html, name);
}

export function parseHazardDefenses(c: CommonExtraction): {
  ac:          number | null;
  saves:       { fort: number | null; ref: number | null; will: number | null };
  hardness:    HazardComponent[];
  hp:          HazardComponent[];
  immunities:  string[];
  weaknesses:  Array<{ type: string; value: number }>;
  resistances: Array<{ type: string; value: number; exceptions: string | null }>;
} {
  return {
    ac:    asInt(getHazardField(c, 'AC')),
    saves: {
      fort: asInt(getHazardField(c, 'Fort')),
      ref:  asInt(getHazardField(c, 'Ref')),
      will: asInt(getHazardField(c, 'Will')),
    },
    hardness:    parseHazardComponents(c, 'Hardness'),
    hp:          parseHazardComponents(c, 'HP'),
    immunities:  splitTopLevel(getHazardField(c, 'Immunities') ?? '', ',').filter(Boolean),
    weaknesses:  parseWeaknesses(getHazardField(c, 'Weaknesses')),
    resistances: parseResistances(getHazardField(c, 'Resistances')),
  };
}

export function parseHazardRoutinesAndReset(c: CommonExtraction): {
  routines: HazardRoutine[];
  disable:  Array<{ skill: string; dc: number | null; text: string }>;
  reset:    string | null;
} {
  return {
    routines: parseRoutines(c),
    disable:  parseDisable(getHazardField(c, 'Disable')),
    reset:    getHazardField(c, 'Reset'),
  };
}

export function parseHazardStealth(value: string | null): { dc: number | null; notes: string | null; raw: string | null } {
  return parseStealth(value);
}
