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
  const regex = /<b>\s*Stage\s*(\d+)\s*<\/b>\s*([\s\S]*?)(?=<b>\s*Stage\s*\d+\s*<\/b>|<hr|$)/gi;
  const out: ConditionStage[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const stage = parseInt(match[1] ?? '0', 10);
    const body = htmlToText(match[2] ?? '');
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
  const match = /DC\s*(\d+)\s*(.*)/i.exec(value);
  if (match === null) return { dc: null, notes: value, raw: value };
  const notes = (match[2] ?? '').trim();
  return { dc: parseInt(match[1]!, 10), notes: notes === '' ? null : notes, raw: value };
}

export function parseDisable(value: string | null): Array<{ skill: string; dc: number | null; text: string }> {
  if (value === null) return [];
  // Pattern: "DC 15 Athletics (trained) to climb out, or DC 25 Acrobatics …"
  const out: Array<{ skill: string; dc: number | null; text: string }> = [];
  const parts = value.split(/,\s*or\s+|;\s*/);
  for (const part of parts) {
    const match = /DC\s*(\d+)\s+([A-Z][a-zA-Z\s]+?)(?:\s*\(|\s+to\s|$)/.exec(part);
    if (match === null) {
      out.push({ skill: '', dc: null, text: part.trim() });
      continue;
    }
    out.push({ skill: match[2]!.trim(), dc: parseInt(match[1]!, 10), text: part.trim() });
  }
  return out;
}

function parseWeaknesses(value: string | null): Array<{ type: string; value: number }> {
  if (value === null) return [];
  return splitTopLevel(value, ',').flatMap((part) => {
    const match = /^(.+?)\s+(\d+)$/.exec(part);
    if (match === null) return [];
    return [{ type: match[1]!.trim(), value: parseInt(match[2]!, 10) }];
  });
}

function parseResistances(value: string | null): Array<{ type: string; value: number; exceptions: string | null }> {
  if (value === null) return [];
  return splitTopLevel(value, ',').flatMap((part) => {
    const match = /^(.+?)\s+(\d+)\s*(?:\(except\s+(.+)\))?$/.exec(part);
    if (match === null) return [];
    return [{
      type:       match[1]!.trim(),
      value:      parseInt(match[2]!, 10),
      exceptions: match[3] !== undefined ? match[3].trim() : null,
    }];
  });
}

function parseHazardComponents(common: CommonExtraction, suffix: 'Hardness' | 'HP'): HazardComponent[] {
  // AON labels these as `<Component> Hardness`, `<Component> HP` — collect
  // every field whose label ends with the suffix.
  const out: HazardComponent[] = [];

  // First try the header fields (older hazard pages or pages with hr separator).
  for (const field of common.fields) {
    const match = new RegExp(`^(.*?)\\s*${suffix}$`, 'i').exec(field.label);
    if (match === null) continue;
    const component = (match[1] ?? '').trim() || 'main';
    const value = asInt(field.value_text);
    if (value === null) continue;
    const btMatch = /\(BT\s*(\d+)\)/i.exec(field.value_text);
    const noteMatch = /\((.*?)\)/.exec(field.value_text);
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
  const bodyHtml = common.body_html;
  const regex = new RegExp(`<b>\\s*(?:([\\w ]+)\\s+)?${suffix}\\s*<\\/b>\\s*([^<;]+?)(?=<b>|;|<br|$)`, 'gi');
  let bodyMatch: RegExpExecArray | null;
  while ((bodyMatch = regex.exec(bodyHtml)) !== null) {
    const component = (bodyMatch[1] ?? '').trim() || 'main';
    const raw = (bodyMatch[2] ?? '').trim();
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

function parseRoutines(common: CommonExtraction): HazardRoutine[] {
  // Any unknown `<b>Label</b>` field followed by Trigger/Effect siblings is a
  // routine. We scan common.fields and group labels we don't recognize.
  const out: HazardRoutine[] = [];
  let cur: HazardRoutine | null = null;
  for (const field of common.fields) {
    if (KNOWN_HAZARD_LABELS.has(field.label) || /Hardness$/.test(field.label) || /\bHP$/.test(field.label)) {
      if (field.label === 'Trigger' && cur !== null) cur.trigger = field.value_text;
      if (field.label === 'Effect'  && cur !== null) cur.effect  = field.value_text;
      if (field.label === 'Reset')                   continue;
      continue;
    }
    // New routine.
    cur = { name: field.label, trigger: null, effect: field.value_text, actions: null };
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
  const regex = new RegExp(`<b>\\s*${escapedLabel}\\s*<\\/b>\\s*([\\s\\S]*?)(?=<b>|<h[1-6]|$)`, 'i');
  const match = regex.exec(bodyHtml);
  if (match === null) return null;
  const text = htmlToText(match[1] ?? '');
  return text === '' ? null : text;
}

/** Convenience: header lookup with body-HTML fallback for label `name`. */
export function getHazardField(common: CommonExtraction, name: string): string | null {
  return getField(common, name) ?? getBodyField(common.body_html, name);
}

export function parseHazardDefenses(common: CommonExtraction): {
  ac:          number | null;
  saves:       { fort: number | null; ref: number | null; will: number | null };
  hardness:    HazardComponent[];
  hp:          HazardComponent[];
  immunities:  string[];
  weaknesses:  Array<{ type: string; value: number }>;
  resistances: Array<{ type: string; value: number; exceptions: string | null }>;
} {
  return {
    ac:    asInt(getHazardField(common, 'AC')),
    saves: {
      fort: asInt(getHazardField(common, 'Fort')),
      ref:  asInt(getHazardField(common, 'Ref')),
      will: asInt(getHazardField(common, 'Will')),
    },
    hardness:    parseHazardComponents(common, 'Hardness'),
    hp:          parseHazardComponents(common, 'HP'),
    immunities:  splitTopLevel(getHazardField(common, 'Immunities') ?? '', ',').filter(Boolean),
    weaknesses:  parseWeaknesses(getHazardField(common, 'Weaknesses')),
    resistances: parseResistances(getHazardField(common, 'Resistances')),
  };
}

export function parseHazardRoutinesAndReset(common: CommonExtraction): {
  routines: HazardRoutine[];
  disable:  Array<{ skill: string; dc: number | null; text: string }>;
  reset:    string | null;
} {
  return {
    routines: parseRoutines(common),
    disable:  parseDisable(getHazardField(common, 'Disable')),
    reset:    getHazardField(common, 'Reset'),
  };
}

export function parseHazardStealth(value: string | null): { dc: number | null; notes: string | null; raw: string | null } {
  return parseStealth(value);
}
