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
  const m = /<span\s+class=['"]action['"][^>]*>\s*\[([a-z-]+)\]/i.exec(html);
  if (m === null) return null;
  const label = m[1]!.toLowerCase();
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
  const m = /^(.*?)\s*([+-]\d+)\s*(?:\[([+\-\d/]+)\])?\s*(?:\(([^)]*)\))?\s*,?\s*$/.exec(cleaned);
  let weapon: string;
  let attack_bonus: number | null = null;
  let map_bonuses: [number, number] | null = null;
  let traits: string[] = [];
  if (m !== null) {
    weapon = m[1]!.trim();
    const ab = parseInt(m[2]!, 10);
    attack_bonus = Number.isFinite(ab) ? ab : null;
    if (m[3] !== undefined) {
      const bm = /([+-]?\d+)\s*\/\s*([+-]?\d+)/.exec(m[3]);
      if (bm !== null) {
        const a = parseInt(bm[1]!, 10);
        const b = parseInt(bm[2]!, 10);
        if (Number.isFinite(a) && Number.isFinite(b)) map_bonuses = [a, b];
      }
    }
    if (m[4] !== undefined) {
      traits = splitTopLevel(m[4], ',').map((s) => s.trim()).filter((s) => s !== '');
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
      const c = chunk.trim();
      if (c === '') continue;
      const persistent = /^persistent\s+/i.test(c);
      const body = persistent ? c.replace(/^persistent\s+/i, '') : c;
      const dm = /^(\d+d\d+(?:[+-]\d+)?)\s+(.+)$/i.exec(body);
      if (dm !== null) damage.push({ dice: dm[1]!, type: dm[2]!.trim(), persistent });
      else tail.push(c);
    }
    if (tail.length > 0) effects = tail.join('; ');
  }
  return { kind, action, weapon, attack_bonus, map_bonuses, traits, damage, effects };
}

/** Classify a spell-list label into kind + tradition. */
function classifySpellList(label: string): { tradition: string | null; kind: MonsterSpellList['kind'] } | null {
  const m = /(Innate Spells|Focus Spells|Rituals|Spells)$/i.exec(label.trim());
  if (m === null) return null;
  const tail = m[1]!.toLowerCase();
  const kind: MonsterSpellList['kind'] =
    tail === 'innate spells' ? 'innate' :
    tail === 'focus spells' ? 'focus' :
    tail === 'rituals' ? 'rituals' : 'spells';
  const tradition = label.slice(0, m.index).trim();
  return { tradition: tradition === '' ? null : tradition, kind };
}

/** Parse one spell-list value-html into a MonsterSpellList. */
function parseSpellList(label: string, valueHtml: string): MonsterSpellList | null {
  const cls = classifySpellList(label);
  if (cls === null) return null;
  let dc: number | null = null;
  let attack: number | null = null;
  const firstBold = /<b>/i.exec(valueHtml);
  const headerText = htmlToText(firstBold !== null ? valueHtml.slice(0, firstBold.index) : valueHtml);
  const dcMatch = /DC\s+(\d+)/i.exec(headerText);
  if (dcMatch !== null) dc = parseInt(dcMatch[1]!, 10);
  const atkMatch = /attack\s+([+-]\d+)/i.exec(headerText);
  if (atkMatch !== null) attack = parseInt(atkMatch[1]!, 10);

  const slots: MonsterSpellList['slots'] = [];
  const body = firstBold !== null ? valueHtml.slice(firstBold.index) : '';
  const chunkRe = /<b>\s*([^<]+?)\s*<\/b>([\s\S]*?)(?=<b>|$)/gi;
  let cm: RegExpExecArray | null;
  while ((cm = chunkRe.exec(body)) !== null) {
    slots.push({ rank: cm[1]!.trim(), spells: parseSpellEntries(cm[2] ?? '') });
  }
  return { tradition: cls.tradition, kind: cls.kind, dc, attack, slots };
}

/** Parse the comma-separated spell list inside one rank chunk. */
function parseSpellEntries(html: string): Array<{ name: string; frequency: string | null; count: number | null }> {
  const text = htmlToText(html).replace(/[;,]\s*$/, '').trim();
  if (text === '') return [];
  const out: Array<{ name: string; frequency: string | null; count: number | null }> = [];
  for (const raw of splitTopLevel(text, ',')) {
    const part = raw.trim();
    if (part === '') continue;
    const m = /^(.*?)(?:\s*\(([^)]+)\))?\s*$/.exec(part);
    if (m === null) continue;
    const name = m[1]!.trim();
    let frequency: string | null = null;
    let count: number | null = null;
    if (m[2] !== undefined) {
      const annot = m[2].trim();
      const xMatch = /^[x×]\s*(\d+)$/i.exec(annot);
      if (xMatch !== null) count = parseInt(xMatch[1]!, 10);
      frequency = annot;
    }
    if (name !== '') out.push({ name, frequency, count });
  }
  return out;
}

/** Discover spell-list fields in head fields + offense fragment. */
function collectSpellLists(c: CommonExtraction, offenseHtml: string): MonsterSpellList[] {
  const out: MonsterSpellList[] = [];
  for (const f of c.fields) {
    if (SPELL_LIST_LABEL_RE.test(f.label)) {
      const list = parseSpellList(f.label, f.value_html);
      if (list !== null) out.push(list);
    }
  }
  const spellLabelRe = /<b>\s*([^<]+?)\s*<\/b>/gi;
  let m: RegExpExecArray | null;
  while ((m = spellLabelRe.exec(offenseHtml)) !== null) {
    const label = (m[1] ?? '').replace(/:$/, '').trim();
    if (!SPELL_LIST_LABEL_RE.test(label)) continue;
    const valueStart = m.index + m[0].length;
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
export function parseStatblockOffense(offenseHtml: string, c: CommonExtraction): StatblockOffense {
  const offLabels = harvestFragmentLabels(offenseHtml);
  return {
    speed:       parseSpeed(offLabels.get('speed') ?? null),
    strikes:     parseStrikes(offenseHtml),
    spell_lists: collectSpellLists(c, offenseHtml),
  };
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
