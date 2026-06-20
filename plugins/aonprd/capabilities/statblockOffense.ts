/**
 * Statblock offense capability — extract speed, strikes, spell lists.
 *
 * Exports: StatblockOffense interface, parseStatblockOffense function.
 */
import type { CommonExtraction } from '../common.js';
import {
  htmlToText,
  splitTopLevel,
  collectHangingIndentInners,
} from '../common.js';
import type { MonsterStrike, MonsterSpellList } from '../concepts/monster/types.js';
import { SPELL_LIST_LABEL_RE } from '../concepts/monster/types.js';

export interface StatblockOffense {
  speed:       { walk: number | null; burrow: number | null; climb: number | null; fly: number | null; swim: number | null; special: string | null };
  strikes:     MonsterStrike[];
  spell_lists: MonsterSpellList[];
}

/** Parse Speed `N feet, mode N feet, …`. */
function parseSpeed(raw: string | null): StatblockOffense['speed'] {
  const out: StatblockOffense['speed'] = {
    walk: null, burrow: null, climb: null, fly: null, swim: null, special: null,
  };
  if (raw === null) return out;
  const specials: string[] = [];
  for (const part of splitTopLevel(raw, ',')) {
    const trimmed = part.trim();
    const mode = /^(burrow|climb|fly|swim)\s+(\d+)\s*feet/i.exec(trimmed);
    if (mode !== null) {
      out[mode[1]!.toLowerCase() as 'burrow' | 'climb' | 'fly' | 'swim'] = parseInt(mode[2]!, 10);
      continue;
    }
    const walk = /^(\d+)\s*feet$/i.exec(trimmed);
    if (walk !== null) { out.walk = parseInt(walk[1]!, 10); continue; }
    if (trimmed !== '') specials.push(trimmed);
  }
  out.special = specials.length > 0 ? specials.join('; ') : null;
  return out;
}

/** Read action cost from a `<span class='action'>[label]</span>` glyph. */
function parseActionGlyph(html: string): MonsterStrike['action'] {
  const match = /<span\s+class=['"]action['"][^>]*>\s*\[([a-z-]+)\]/i.exec(html);
  if (match === null) return null;
  const label = match[1]!.toLowerCase();
  const actionMap = new Map<string, MonsterStrike['action']>([
    ['one-action', 'one-action'], ['single-action', 'one-action'],
    ['two-actions', 'two-actions'], ['three-actions', 'three-actions'],
    ['reaction', 'reaction'], ['free-action', 'free-action'],
  ]);
  return actionMap.get(label) ?? null;
}

/** Strip action-glyph spans from HTML. */
function stripActionGlyphs(html: string): string {
  return html.replace(/<span\s+class=['"]action['"][^>]*>\s*\[[a-z-]+\]\s*<\/span>/gi, ' ');
}

/** Parse strike fragments from the offense HTML. */
function parseStrikes(bodyHtml: string): MonsterStrike[] {
  const out: MonsterStrike[] = [];
  for (const inner of collectHangingIndentInners(bodyHtml)) {
    const kindMatch = /^\s*<b>\s*(Melee|Ranged)\s*<\/b>/i.exec(inner);
    if (kindMatch === null) continue;
    const kind = kindMatch[1]!.toLowerCase() === 'ranged' ? 'ranged' : 'melee';
    out.push(parseStrikeBody(kind, inner.slice(kindMatch.index + kindMatch[0].length)));
  }
  return out;
}

/** Parse the inner HTML of one Melee/Ranged hanging-indent span. */
function parseStrikeBody(kind: 'melee' | 'ranged', innerHtml: string): MonsterStrike {
  const action = parseActionGlyph(innerHtml);
  const dmgSplit = /<b>\s*Damage\s*<\/b>([\s\S]*)$/i.exec(innerHtml);
  const headHtml = dmgSplit !== null ? innerHtml.slice(0, dmgSplit.index) : innerHtml;
  const dmgHtml = dmgSplit !== null ? (dmgSplit[1] ?? '') : '';

  const cleaned = htmlToText(stripActionGlyphs(headHtml));
  const match = /^(.*?)\s*([+-]\d+)\s*(?:\[([+\-\d/]+)\])?\s*(?:\(([^)]*)\))?\s*,?\s*$/.exec(cleaned);
  let weapon: string;
  let attack_bonus: number | null = null;
  let map_bonuses: [number, number] | null = null;
  let traits: string[] = [];
  if (match !== null) {
    weapon = match[1]!.trim();
    const attackBonus = parseInt(match[2]!, 10);
    attack_bonus = Number.isFinite(attackBonus) ? attackBonus : null;
    if (match[3] !== undefined) {
      const bonusMatch = /([+-]?\d+)\s*\/\s*([+-]?\d+)/.exec(match[3]);
      if (bonusMatch !== null) {
        const aVal = parseInt(bonusMatch[1]!, 10);
        const bVal = parseInt(bonusMatch[2]!, 10);
        if (Number.isFinite(aVal) && Number.isFinite(bVal)) map_bonuses = [aVal, bVal];
      }
    }
    if (match[4] !== undefined) {
      traits = splitTopLevel(match[4], ',').map((str) => str.trim()).filter((str) => str !== '');
    }
  } else {
    weapon = cleaned;
  }

  const damage: MonsterStrike['damage'] = [];
  let effects: string | null = null;
  if (dmgHtml !== '') {
    const dmgText = htmlToText(dmgHtml).trim().replace(/[,;]\s*$/, '');
    const tail: string[] = [];
    for (const chunk of dmgText.split(/\s+plus\s+/i)) {
      const chunkTrimmed = chunk.trim();
      if (chunkTrimmed === '') continue;
      const persistent = /^persistent\s+/i.test(chunkTrimmed);
      const body = persistent ? chunkTrimmed.replace(/^persistent\s+/i, '') : chunkTrimmed;
      const damageMatch = /^(\d+d\d+(?:[+-]\d+)?)\s+(.+)$/i.exec(body);
      if (damageMatch !== null) damage.push({ dice: damageMatch[1]!, type: damageMatch[2]!.trim(), persistent });
      else tail.push(chunkTrimmed);
    }
    if (tail.length > 0) effects = tail.join('; ');
  }
  return { kind, action, weapon, attack_bonus, map_bonuses, traits, damage, effects };
}

/** Classify a spell-list label into kind + tradition. */
function classifySpellList(label: string): { tradition: string | null; kind: MonsterSpellList['kind'] } | null {
  const match = /(Innate Spells|Focus Spells|Rituals|Spells)$/i.exec(label.trim());
  if (match === null) return null;
  const tail = match[1]!.toLowerCase();
  const kind: MonsterSpellList['kind'] =
    tail === 'innate spells' ? 'innate' :
    tail === 'focus spells' ? 'focus' :
    tail === 'rituals' ? 'rituals' : 'spells';
  const tradition = label.slice(0, match.index).trim();
  return { tradition: tradition === '' ? null : tradition, kind };
}

/** Parse one spell-list value-html into a MonsterSpellList. */
function parseSpellList(label: string, valueHtml: string): MonsterSpellList | null {
  const cls = classifySpellList(label);
  if (cls === null) return null;
  let dcVal: number | null = null;
  let attack: number | null = null;
  const firstBold = /<b>/i.exec(valueHtml);
  const headerText = htmlToText(firstBold !== null ? valueHtml.slice(0, firstBold.index) : valueHtml);
  const dcMatch = /DC\s+(\d+)/i.exec(headerText);
  if (dcMatch !== null) dcVal = parseInt(dcMatch[1]!, 10);
  const atkMatch = /attack\s+([+-]\d+)/i.exec(headerText);
  if (atkMatch !== null) attack = parseInt(atkMatch[1]!, 10);

  const slots: MonsterSpellList['slots'] = [];
  const body = firstBold !== null ? valueHtml.slice(firstBold.index) : '';
  const chunkRe = /<b>\s*([^<]+?)\s*<\/b>([\s\S]*?)(?=<b>|$)/gi;
  let chunkMatch: RegExpExecArray | null;
  while ((chunkMatch = chunkRe.exec(body)) !== null) {
    slots.push({ rank: chunkMatch[1]!.trim(), spells: parseSpellEntries(chunkMatch[2] ?? '') });
  }
  return { tradition: cls.tradition, kind: cls.kind, dc: dcVal, attack, slots };
}

/** Parse the comma-separated spell list inside one rank chunk. */
function parseSpellEntries(html: string): Array<{ name: string; frequency: string | null; count: number | null }> {
  const text = htmlToText(html).replace(/[;,]\s*$/, '').trim();
  if (text === '') return [];
  const out: Array<{ name: string; frequency: string | null; count: number | null }> = [];
  for (const raw of splitTopLevel(text, ',')) {
    const part = raw.trim();
    if (part === '') continue;
    const match = /^(.*?)(?:\s*\(([^)]+)\))?\s*$/.exec(part);
    if (match === null) continue;
    const name = match[1]!.trim();
    let frequency: string | null = null;
    let count: number | null = null;
    if (match[2] !== undefined) {
      const annot = match[2].trim();
      const xMatch = /^[x×]\s*(\d+)$/i.exec(annot);
      if (xMatch !== null) count = parseInt(xMatch[1]!, 10);
      frequency = annot;
    }
    if (name !== '') out.push({ name, frequency, count });
  }
  return out;
}

/** Discover spell-list fields in head fields + offense fragment. */
function collectSpellLists(common: CommonExtraction, offenseHtml: string): MonsterSpellList[] {
  const out: MonsterSpellList[] = [];
  for (const field of common.fields) {
    if (SPELL_LIST_LABEL_RE.test(field.label)) {
      const list = parseSpellList(field.label, field.value_html);
      if (list !== null) out.push(list);
    }
  }
  const spellLabelRe = /<b>\s*([^<]+?)\s*<\/b>/gi;
  let match: RegExpExecArray | null;
  while ((match = spellLabelRe.exec(offenseHtml)) !== null) {
    const label = (match[1] ?? '').replace(/:$/, '').trim();
    if (!SPELL_LIST_LABEL_RE.test(label)) continue;
    const valueStart = match.index + match[0].length;
    const boundaryRe = /<span\s+class="hanging-indent"|<div\b/i;
    const boundaryMatch = boundaryRe.exec(offenseHtml.slice(valueStart));
    const valueEnd = boundaryMatch !== null ? valueStart + boundaryMatch.index : offenseHtml.length;
    const valueHtml = offenseHtml.slice(valueStart, valueEnd);
    const list = parseSpellList(label, valueHtml);
    if (list !== null) out.push(list);
  }
  return out;
}

/**
 * Parse statblock offense from HTML fragment.
 * Extracts speed, strikes, spell lists.
 */
export function parseStatblockOffense(offenseHtml: string, common: CommonExtraction): StatblockOffense {
  const offLabels = harvestFragmentLabels(offenseHtml);
  return {
    speed:       parseSpeed(offLabels.get('speed') ?? null),
    strikes:     parseStrikes(offenseHtml),
    spell_lists: collectSpellLists(common, offenseHtml),
  };
}

/** Harvest `<b>Label</b>` value pairs from a body fragment. */
function harvestFragmentLabels(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of html.split(/<br\s*\/?>/i)) {
    const regex = /<b>\s*([^<]+?)\s*<\/b>\s*([\s\S]*?)(?=<b>|$)/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(line)) !== null) {
      const label = (match[1] ?? '').replace(/:$/, '').trim();
      const valueText = htmlToText(match[2] ?? '');
      if (label === '' || valueText === '') continue;
      if (!out.has(label.toLowerCase())) out.set(label.toLowerCase(), valueText);
    }
  }
  return out;
}
