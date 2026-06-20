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
import type { MonsterOutput } from './types.js';
import {
  ACTION_LABEL_TO_COST,
} from './types.js';
import {
  htmlToText,
  splitTopLevel,
  asInt,
} from '../../common.js';
import type { ActionCost } from '../../common.js';

/** Read action cost from a `<span class='action'>[label]</span>` glyph. */
export function parseActionGlyph(html: string): ActionCost | null {
  const match = /<span\s+class=['"]action['"][^>]*>\s*\[([a-z-]+)\]/i.exec(html);
  return match === null ? null : ACTION_LABEL_TO_COST.get(match[1]!.toLowerCase()) ?? null;
}

/** Strip action-glyph spans from HTML. */
export function stripActionGlyphs(html: string): string {
  return html.replace(/<span\s+class=['"]action['"][^>]*>\s*\[[a-z-]+\]\s*<\/span>/gi, ' ');
}

/** Pop a leading `(traits, …)` cluster from text, returning list + rest. */
export function extractLeadingTraits(text: string): { traits: string[]; rest: string } {
  const match = /^\s*\(([^)]*)\)\s*/.exec(text);
  if (match === null) return { traits: [], rest: text.trim() };
  const traits = splitTopLevel(match[1] ?? '', ',').map((seg) => seg.trim()).filter((seg) => seg !== '');
  return { traits, rest: text.slice(match[0].length).trim() };
}

/** Split a fragment on `;` only at depth 0 and only when followed by `<b>`. */
export function splitOnLabelSemis(html: string): string[] {
  const out: string[] = [];
  let buf = '';
  let depth = 0;
  for (let index = 0; index < html.length; index++) {
    const char = html[index]!;
    if (char === '<') depth++;
    if (char === '>') depth = Math.max(0, depth - 1);
    if (char === ';' && depth === 0) {
      const rest = html.slice(index + 1).replace(/^\s+/, '');
      if (/^<b>/i.test(rest)) { out.push(buf); buf = ''; continue; }
    }
    buf += char;
  }
  if (buf !== '') out.push(buf);
  return out;
}

/** Return text following `<b>Label</b>` up to the next `<b>` or end. */
export function pullLabel(html: string, label: string): string | null {
  const regex = new RegExp(`<b>\\s*${label}\\s*<\\/b>([\\s\\S]*?)(?=<b>|$)`, 'i');
  const match = regex.exec(html);
  if (match === null) return null;
  const text = htmlToText(match[1] ?? '').replace(/^[\s;,]+|[\s;,]+$/g, '');
  return text === '' ? null : text;
}

/** Re-harvest `<b>Label</b>` pairs from a body fragment past the head `<hr/>`. */
export function harvestFragmentLabels(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of html.split(/<br\s*\/?>/i)) {
    for (const seg of splitOnLabelSemis(line)) {
      const regex = /<b>\s*([^<]+?)\s*<\/b>\s*([\s\S]*?)(?=<b>|$)/gi;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(seg)) !== null) {
        const label = (match[1] ?? '').replace(/:$/, '').trim();
        const valueText = htmlToText(match[2] ?? '');
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
  const dcVal = asInt(raw);
  const lores: Array<{ trait: string; skill: string }> = [];
  const tail = raw.split('•').slice(1).join('•');
  if (tail.trim() !== '') {
    for (const part of splitTopLevel(tail, ',')) {
      const match = /^\s*([^(]+?)\s*\(([^)]+)\)/.exec(part);
      if (match !== null) lores.push({ trait: match[1]!.trim(), skill: match[2]!.trim() });
    }
  }
  return { dc: dcVal, lores, raw };
}

/** Parse Perception `+N; sense, sense, …`. */
export function parsePerception(raw: string | null): MonsterOutput['perception'] {
  if (raw === null) return { modifier: null, senses: [], raw: null };
  const [head, ...tail] = raw.split(';');
  const modifier = asInt(head ?? '');
  const senses = splitTopLevel(tail.join(';').trim(), ',').map((seg) => seg.trim()).filter((seg) => seg !== '');
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
      const trimmed = lang.trim();
      if (trimmed !== '') languages.push(trimmed);
    }
  }
  const special = tail.join(';').split(',').map((seg) => seg.trim()).filter((seg) => seg !== '');
  return { languages, special, raw };
}

/** Parse Skills `Skill +N (parens conditional +M to X)?, …`. */
export function parseSkills(raw: string | null): MonsterOutput['skills'] {
  if (raw === null) return [];
  const out: MonsterOutput['skills'] = [];
  for (const part of splitTopLevel(raw, ',')) {
    const match = /^([^+\-(]+?)\s*([+-]\d+)\s*(?:\(([^)]*)\))?/.exec(part);
    if (match === null) continue;
    const name = match[1]!.trim();
    const modifier = parseInt(match[2]!, 10);
    const conditionals: Array<{ bonus: number; context: string }> = [];
    if (match[3] !== undefined) {
      const condMatch = /([+-]\d+)\s*(.*)/.exec(match[3]);
      if (condMatch !== null) {
        const bonus = parseInt(condMatch[1]!, 10);
        const context = (condMatch[2] ?? '').trim();
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
  return splitTopLevel(raw, ',').map((seg) => seg.trim()).filter((seg) => seg !== '');
}

