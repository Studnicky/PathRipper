import type { CommonExtraction } from '../../common.js';
import {
  getField,
  asInt,
  splitTopLevel,
  htmlToText,
} from '../../common.js';
import type { HazardComponent, HazardRoutine } from './types.js';

const KNOWN_HAZARD_LABELS = new Set<string>([
  'Source', 'Complexity', 'Stealth', 'Description', 'Disable',
  'AC', 'Fort', 'Ref', 'Will', 'Immunities', 'Weaknesses', 'Resistances', 'Hardness', 'HP',
  'Trigger', 'Effect', 'Reset', 'Routine',
]);

export function parseStealth(value: string | null): { dc: number | null; notes: string | null; raw: string | null } {
  if (value === null) return { dc: null, notes: null, raw: null };
  const match = /DC\s*(\d+)\s*(.*)/i.exec(value);
  if (match === null) return { dc: null, notes: value, raw: value };
  const notes = (match[2] ?? '').trim();
  return { dc: parseInt(match[1]!, 10), notes: notes === '' ? null : notes, raw: value };
}

export function parseDisable(value: string | null): Array<{ skill: string; dc: number | null; text: string }> {
  if (value === null) return [];
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

export function parseWeaknesses(value: string | null): Array<{ type: string; value: number }> {
  if (value === null) return [];
  return splitTopLevel(value, ',').flatMap((part) => {
    const match = /^(.+?)\s+(\d+)$/.exec(part);
    if (match === null) return [];
    return [{ type: match[1]!.trim(), value: parseInt(match[2]!, 10) }];
  });
}

export function parseResistances(value: string | null): Array<{ type: string; value: number; exceptions: string | null }> {
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

export function parseHazardComponents(common: CommonExtraction, suffix: 'Hardness' | 'HP'): HazardComponent[] {
  const out: HazardComponent[] = [];

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

export function parseRoutines(common: CommonExtraction): HazardRoutine[] {
  const out: HazardRoutine[] = [];
  let cur: HazardRoutine | null = null;
  for (const field of common.fields) {
    if (KNOWN_HAZARD_LABELS.has(field.label) || /Hardness$/.test(field.label) || /\bHP$/.test(field.label)) {
      if (field.label === 'Trigger' && cur !== null) cur.trigger = field.value_text;
      if (field.label === 'Effect'  && cur !== null) cur.effect  = field.value_text;
      if (field.label === 'Reset')                   continue;
      continue;
    }
    cur = { name: field.label, trigger: null, effect: field.value_text, actions: null };
    out.push(cur);
  }
  return out;
}

function getBodyField(bodyHtml: string, label: string): string | null {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`<b>\\s*${escapedLabel}\\s*<\\/b>\\s*([\\s\\S]*?)(?=<b>|<h[1-6]|$)`, 'i');
  const match = regex.exec(bodyHtml);
  if (match === null) return null;
  const text = htmlToText(match[1] ?? '');
  return text === '' ? null : text;
}

export function getHazardField(common: CommonExtraction, name: string): string | null {
  return getField(common, name) ?? getBodyField(common.body_html, name);
}

export { KNOWN_HAZARD_LABELS };
