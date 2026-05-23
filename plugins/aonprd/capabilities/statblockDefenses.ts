/**
 * Statblock defenses capability — extract AC, saves, HP, hardness, immunities, weaknesses, resistances.
 *
 * Exports: StatblockDefenses interface, parseStatblockDefenses function.
 */
import {
  htmlToText,
  asInt,
  splitTopLevel,
} from '../common.js';
import type { SaveName } from '../concepts/monster/types.js';

export interface StatblockDefenses {
  ac:          { value: number | null; conditional: string | null; saves_note: string | null };
  saves:       Record<SaveName, number | null>;
  hp:          { value: number | null; special: string | null };
  hardness:    number | null;
  immunities:  string[];
  weaknesses:  Array<{ type: string; value: number }>;
  resistances: Array<{ type: string; value: number; exceptions: string | null }>;
}

/** Parse AC `N (M while …)?` plus a separate saves note. */
function parseAc(raw: string | null, savesNote: string | null): StatblockDefenses['ac'] {
  if (raw === null) return { value: null, conditional: null, saves_note: savesNote };
  const m = /^\s*(-?\d+)\s*(?:\(([^)]+)\))?/.exec(raw);
  if (m === null) return { value: null, conditional: null, saves_note: savesNote };
  return {
    value: parseInt(m[1]!, 10),
    conditional: m[2] !== undefined ? m[2].trim() : null,
    saves_note: savesNote,
  };
}

/**
 * Parse HP `N [, extra text] [(parens)]`.
 * Captures everything after the numeric value as `special`, covering formats:
 *   - `210`                                       → special: null
 *   - `16 (fast healing 2)`                       → special: "fast healing 2"
 *   - `380, regeneration 20 (deactivated by holy)`→ special: "regeneration 20 (deactivated by holy)"
 */
function parseHp(raw: string | null): StatblockDefenses['hp'] {
  if (raw === null) return { value: null, special: null };
  const m = /^\s*(-?\d+)\s*,?\s*(.+)?$/.exec(raw.trim());
  if (m === null) return { value: null, special: null };
  const value = parseInt(m[1]!, 10);
  const rest = (m[2] ?? '').trim();
  return { value: Number.isFinite(value) ? value : null, special: rest !== '' ? rest : null };
}

/** Parse Immunities — comma-separated linked types. */
function parseImmunities(raw: string | null): string[] {
  if (raw === null) return [];
  return splitTopLevel(raw, ',').map((s) => s.trim()).filter((s) => s !== '');
}

/** Parse Weaknesses `type N, …`. */
function parseWeaknesses(raw: string | null): StatblockDefenses['weaknesses'] {
  if (raw === null) return [];
  const out: StatblockDefenses['weaknesses'] = [];
  for (const part of splitTopLevel(raw, ',')) {
    const m = /^(.*?)\s+(\d+)\s*$/.exec(part.trim());
    if (m !== null) {
      const value = parseInt(m[2]!, 10);
      if (Number.isFinite(value)) out.push({ type: m[1]!.trim(), value });
    }
  }
  return out;
}

/** Parse Resistances `type N (except …), …`. */
function parseResistances(raw: string | null): StatblockDefenses['resistances'] {
  if (raw === null) return [];
  const out: StatblockDefenses['resistances'] = [];
  for (const part of splitTopLevel(raw, ',')) {
    const m = /^(.*?)\s+(\d+)\s*(?:\(([^)]*except[^)]*)\))?/i.exec(part.trim());
    if (m !== null) {
      const value = parseInt(m[2]!, 10);
      if (Number.isFinite(value)) {
        out.push({
          type: m[1]!.trim(),
          value,
          exceptions: m[3] !== undefined ? m[3].replace(/^except\s*/i, '').trim() : null,
        });
      }
    }
  }
  return out;
}

/** Harvest `<b>Label</b>` value pairs from a body fragment. */
function harvestFragmentLabels(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of html.split(/<br\s*\/?>/i)) {
    const re = /<b>\s*([^<]+?)\s*<\/b>\s*([\s\S]*?)(?=<b>|$)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const label = (m[1] ?? '').replace(/:$/, '').trim();
      const valueText = htmlToText(m[2] ?? '');
      if (label === '' || valueText === '') continue;
      if (!out.has(label.toLowerCase())) out.set(label.toLowerCase(), valueText);
    }
  }
  return out;
}

/**
 * Parse statblock defenses from HTML fragment.
 * Extracts AC, saves, HP, hardness, immunities, weaknesses, resistances.
 */
export function parseStatblockDefenses(defensesHtml: string): StatblockDefenses {
  const defLabels = harvestFragmentLabels(defensesHtml);

  let savesNote: string | null = null;
  const noteMatch = /<b>\s*Will\s*<\/b>\s*[+-]?\d+\s*;\s*([^<]+?)(?=<br|<\/?span|<b>|$)/i.exec(defensesHtml);
  if (noteMatch !== null) {
    const n = htmlToText(noteMatch[1] ?? '').trim();
    if (n !== '' && !/^\+?\d/.test(n)) savesNote = n;
  }

  return {
    ac:          parseAc(defLabels.get('ac') ?? null, savesNote),
    saves: {
      fort: asInt(defLabels.get('fort') ?? null),
      ref:  asInt(defLabels.get('ref')  ?? null),
      will: asInt(defLabels.get('will') ?? null),
    },
    hp:          parseHp(defLabels.get('hp') ?? null),
    hardness:    asInt(defLabels.get('hardness') ?? null),
    immunities:  parseImmunities(defLabels.get('immunities')  ?? null),
    weaknesses:  parseWeaknesses(defLabels.get('weaknesses')  ?? null),
    resistances: parseResistances(defLabels.get('resistances') ?? null),
  };
}
