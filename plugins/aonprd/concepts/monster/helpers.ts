/**
 * Monster concept — parsing helpers.
 *
 * Core parsing functions: parseActionGlyph, stripActionGlyphs, extractLeadingTraits,
 * splitOnLabelSemis, pullLabel, harvestFragmentLabels, parseRecallKnowledge,
 * parsePerception, parseLanguages, parseSkills, parseItems.
 *
 * Lifted to Layer-1 capabilities:
 * - parseAbilityScores → plugins/aonprd/capabilities/abilityScores.ts
 * - parseAc, parseHp, parseImmunities, parseWeaknesses, parseResistances
 *   → plugins/aonprd/capabilities/statblockDefenses.ts
 * - parseSpeed, parseStrikes, parseSpellList, collectSpellLists
 *   → plugins/aonprd/capabilities/statblockOffense.ts
 */
import type { MonsterOutput, AbilityScore, SaveName } from './types.js';
import {
  ACTION_LABEL_TO_COST,
  KNOWN_LABELS,
  ABILITY_NAMES,
} from './types.js';
import {
  htmlToText,
  splitTopLevel,
  asInt,
} from '../../common.js';
import type { ActionCost, CommonExtraction } from '../../common.js';
import { getField, getAllFields } from '../../common.js';

/** Read action cost from a `<span class='action'>[label]</span>` glyph. */
export function parseActionGlyph(html: string): ActionCost | null {
  const m = /<span\s+class=['"]action['"][^>]*>\s*\[([a-z-]+)\]/i.exec(html);
  return m === null ? null : ACTION_LABEL_TO_COST.get(m[1]!.toLowerCase()) ?? null;
}

/** Strip action-glyph spans from HTML. */
export function stripActionGlyphs(html: string): string {
  return html.replace(/<span\s+class=['"]action['"][^>]*>\s*\[[a-z-]+\]\s*<\/span>/gi, ' ');
}

/** Pop a leading `(traits, …)` cluster from text, returning list + rest. */
export function extractLeadingTraits(text: string): { traits: string[]; rest: string } {
  const m = /^\s*\(([^)]*)\)\s*/.exec(text);
  if (m === null) return { traits: [], rest: text.trim() };
  const traits = splitTopLevel(m[1] ?? '', ',').map((s) => s.trim()).filter((s) => s !== '');
  return { traits, rest: text.slice(m[0].length).trim() };
}

/** Split a fragment on `;` only at depth 0 and only when followed by `<b>`. */
export function splitOnLabelSemis(html: string): string[] {
  const out: string[] = [];
  let buf = '';
  let depth = 0;
  for (let i = 0; i < html.length; i++) {
    const ch = html[i]!;
    if (ch === '<') depth++;
    if (ch === '>') depth = Math.max(0, depth - 1);
    if (ch === ';' && depth === 0) {
      const rest = html.slice(i + 1).replace(/^\s+/, '');
      if (/^<b>/i.test(rest)) { out.push(buf); buf = ''; continue; }
    }
    buf += ch;
  }
  if (buf !== '') out.push(buf);
  return out;
}

/** Return text following `<b>Label</b>` up to the next `<b>` or end. */
export function pullLabel(html: string, label: string): string | null {
  const re = new RegExp(`<b>\\s*${label}\\s*<\\/b>([\\s\\S]*?)(?=<b>|$)`, 'i');
  const m = re.exec(html);
  if (m === null) return null;
  const text = htmlToText(m[1] ?? '').replace(/^[\s;,]+|[\s;,]+$/g, '');
  return text === '' ? null : text;
}

/** Re-harvest `<b>Label</b>` pairs from a body fragment past the head `<hr/>`. */
export function harvestFragmentLabels(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of html.split(/<br\s*\/?>/i)) {
    for (const seg of splitOnLabelSemis(line)) {
      const re = /<b>\s*([^<]+?)\s*<\/b>\s*([\s\S]*?)(?=<b>|$)/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(seg)) !== null) {
        const label = (m[1] ?? '').replace(/:$/, '').trim();
        const valueText = htmlToText(m[2] ?? '');
        if (label === '' || valueText === '') continue;
        if (!out.has(label.toLowerCase())) out.set(label.toLowerCase(), valueText);
      }
    }
  }
  return out;
}

/** Parse Recall Knowledge `DC N [(includes +X from Rarity)] [• Trait (Skill), …]`. */
export function parseRecallKnowledge(raw: string | null): MonsterOutput['recall_knowledge'] {
  if (raw === null) return { dc: null, lores: [], raw: null };
  const dc = asInt(raw);
  const lores: Array<{ trait: string; skill: string }> = [];
  const tail = raw.split('•').slice(1).join('•');
  if (tail.trim() !== '') {
    for (const part of splitTopLevel(tail, ',')) {
      const m = /^\s*([^(]+?)\s*\(([^)]+)\)/.exec(part);
      if (m !== null) lores.push({ trait: m[1]!.trim(), skill: m[2]!.trim() });
    }
  }
  return { dc, lores, raw };
}

/** Parse Perception `+N; sense, sense, …`. */
export function parsePerception(raw: string | null): MonsterOutput['perception'] {
  if (raw === null) return { modifier: null, senses: [], raw: null };
  const [head, ...tail] = raw.split(';');
  const modifier = asInt(head ?? '');
  const senses = splitTopLevel(tail.join(';').trim(), ',').map((s) => s.trim()).filter((s) => s !== '');
  return { modifier, senses, raw };
}

/** Parse Languages `lang, lang; special` with optional `none (parens)`. */
export function parseLanguages(raw: string | null): MonsterOutput['languages'] {
  if (raw === null) return { languages: [], special: [], raw: null };
  const [head, ...tail] = raw.split(';');
  const headStr = (head ?? '').trim();
  const languages: string[] = [];
  if (headStr !== '' && headStr.toLowerCase() !== 'none' && !/^none\s*\(/i.test(headStr)) {
    for (const lang of splitTopLevel(headStr, ',')) {
      const t = lang.trim();
      if (t !== '') languages.push(t);
    }
  }
  const special = tail.join(';').split(',').map((s) => s.trim()).filter((s) => s !== '');
  return { languages, special, raw };
}

/** Parse Skills `Skill +N (parens conditional +M to X)?, …`. */
export function parseSkills(raw: string | null): MonsterOutput['skills'] {
  if (raw === null) return [];
  const out: MonsterOutput['skills'] = [];
  for (const part of splitTopLevel(raw, ',')) {
    const m = /^([^+\-(]+?)\s*([+-]\d+)\s*(?:\(([^)]*)\))?/.exec(part);
    if (m === null) continue;
    const name = m[1]!.trim();
    const modifier = parseInt(m[2]!, 10);
    const conditionals: Array<{ bonus: number; context: string }> = [];
    if (m[3] !== undefined) {
      const cm = /([+-]\d+)\s*(.*)/.exec(m[3]);
      if (cm !== null) {
        const bonus = parseInt(cm[1]!, 10);
        const context = (cm[2] ?? '').trim();
        if (Number.isFinite(bonus)) conditionals.push({ bonus, context });
      }
    }
    if (Number.isFinite(modifier)) out.push({ name, modifier, conditionals });
  }
  return out;
}

/** Parse Items as comma-separated linked equipment names. */
export function parseItems(raw: string | null): string[] {
  if (raw === null) return [];
  return splitTopLevel(raw, ',').map((s) => s.trim()).filter((s) => s !== '');
}

