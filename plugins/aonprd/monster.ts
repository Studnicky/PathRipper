// Pathfinder 2e monster stat block extractor for Archives of Nethys
// (2e.aonprd.com). Re-walks per-section body HTML for strikes, spells, abilities.
import type { CheerioAPI } from 'cheerio';
import {
  type CommonExtraction, type CheerioNode, type ActionCost, type SourceRef,
  getField, getAllFields, asInt, htmlToText, splitTopLevel,
  harvestLinks, type LinkRef,
  extractEntityId, extractMetaDescription, extractMetaKeywords,
} from './common.js';

export type AbilityScore = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
export type SaveName = 'fort' | 'ref' | 'will';

export interface MonsterAbility {
  name: string;
  actions: ActionCost | null;
  traits: string[];
  frequency: string | null;
  trigger: string | null;
  requirements: string | null;
  effect: string | null;
  saving_throw: { dc: number; save: SaveName | null; basic: boolean } | null;
  stages: Array<{ stage: number; text: string }>;
  body_html: string;
  body_text: string;
}

export interface MonsterStrike {
  kind: 'melee' | 'ranged';
  action: ActionCost | null;
  weapon: string;
  attack_bonus: number | null;
  map_bonuses: [number, number] | null;
  traits: string[];
  damage: Array<{ dice: string; type: string; persistent: boolean }>;
  effects: string | null;
}

export interface MonsterSpellList {
  tradition: string | null;
  kind: 'spells' | 'innate' | 'focus' | 'rituals';
  dc: number | null;
  attack: number | null;
  slots: Array<{ rank: string; spells: Array<{ name: string; frequency: string | null; count: number | null }> }>;
}

export interface MonsterOutput {
  _type: 'monster';
  url: string;
  /** Numeric AON ID extracted from the URL query string. */
  monster_id: number | null;
  name: string;
  level: number | null;
  rarity: 'common' | 'uncommon' | 'rare' | 'unique';
  size: string | null;
  alignment: string | null;
  traits: string[];
  /** Trait AON IDs keyed by trait name. */
  trait_ids: Record<string, number>;
  source: { book: string | null; page: number | null; source_id: number | null };
  /** All source refs on the page (header + body footnotes). */
  sources: SourceRef[];
  alt_edition_url: string | null;
  pfs: 'standard' | 'limited' | 'restricted' | null;
  recall_knowledge: { dc: number | null; lores: Array<{ trait: string; skill: string }>; raw: string | null };
  perception: { modifier: number | null; senses: string[]; raw: string | null };
  languages: { languages: string[]; special: string[]; raw: string | null };
  skills: Array<{ name: string; modifier: number; conditionals: Array<{ bonus: number; context: string }> }>;
  abilities: Record<AbilityScore, number | null>;
  items: string[];
  ac: { value: number | null; conditional: string | null; saves_note: string | null };
  saves: Record<SaveName, number | null>;
  hp: { value: number | null; special: string | null };
  hardness: number | null;
  immunities: string[];
  weaknesses: Array<{ type: string; value: number }>;
  resistances: Array<{ type: string; value: number; exceptions: string | null }>;
  speed: { walk: number | null; burrow: number | null; climb: number | null; fly: number | null; swim: number | null; special: string | null };
  strikes: MonsterStrike[];
  spell_lists: MonsterSpellList[];
  top_abilities: MonsterAbility[];
  defensive_abilities: MonsterAbility[];
  offensive_abilities: MonsterAbility[];
  variants: Array<{ kind: 'elite' | 'normal' | 'weak' | 'pwl'; url: string }>;
  /**
   * Monster family group links from the `<b>Related Groups</b>` field.
   * Multiple groups indicate the monster spans families (e.g. Elementals).
   */
  family_links: Array<{ name: string; family_id: number | null }>;
  raw_fields: Record<string, string>;
  links: LinkRef[];
  body_text: string;
  body_html: string;
  /** `<meta name="description">` content. */
  meta_description: string | null;
  /** `<meta name="keywords">` content. */
  meta_keywords: string | null;
}

const ACTION_LABEL_TO_COST: ReadonlyMap<string, ActionCost> = new Map<string, ActionCost>([
  ['one-action', 'one-action'], ['single-action', 'one-action'],
  ['two-actions', 'two-actions'], ['three-actions', 'three-actions'],
  ['reaction', 'reaction'], ['free-action', 'free-action'],
]);

const KNOWN_LABELS: ReadonlySet<string> = new Set<string>([
  'source', 'recall knowledge', 'perception', 'languages', 'skills',
  'str', 'dex', 'con', 'int', 'wis', 'cha',
  'ac', 'fort', 'ref', 'will', 'hp', 'hardness',
  'immunities', 'weaknesses', 'resistances',
  'speed', 'melee', 'ranged', 'damage',
  'cast', 'trigger', 'frequency', 'effect', 'requirements',
  'saving throw', 'maximum duration', 'onset', 'items',
]);

const STAGE_LABEL_RE = /^stage\s+\d+$/i;
const SPELL_LIST_LABEL_RE = /(?:Innate Spells|Focus Spells|Rituals|Spells)$/i;
const ABILITY_NAMES: ReadonlyArray<AbilityScore> = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

/** Read action cost from a `<span class='action'>[label]</span>` glyph. */
function parseActionGlyph(html: string): ActionCost | null {
  const m = /<span\s+class=['"]action['"][^>]*>\s*\[([a-z-]+)\]/i.exec(html);
  return m === null ? null : ACTION_LABEL_TO_COST.get(m[1]!.toLowerCase()) ?? null;
}

/** Strip action-glyph spans from HTML. */
function stripActionGlyphs(html: string): string {
  return html.replace(/<span\s+class=['"]action['"][^>]*>\s*\[[a-z-]+\]\s*<\/span>/gi, ' ');
}

/** Pop a leading `(traits, …)` cluster from text, returning list + rest. */
function extractLeadingTraits(text: string): { traits: string[]; rest: string } {
  const m = /^\s*\(([^)]*)\)\s*/.exec(text);
  if (m === null) return { traits: [], rest: text.trim() };
  const traits = splitTopLevel(m[1] ?? '', ',').map((s) => s.trim()).filter((s) => s !== '');
  return { traits, rest: text.slice(m[0].length).trim() };
}

/** Split a fragment on `;` only at depth 0 and only when followed by `<b>`. */
function splitOnLabelSemis(html: string): string[] {
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
function pullLabel(html: string, label: string): string | null {
  const re = new RegExp(`<b>\\s*${label}\\s*<\\/b>([\\s\\S]*?)(?=<b>|$)`, 'i');
  const m = re.exec(html);
  if (m === null) return null;
  const text = htmlToText(m[1] ?? '').replace(/^[\s;,]+|[\s;,]+$/g, '');
  return text === '' ? null : text;
}

/** Re-harvest `<b>Label</b>` pairs from a body fragment past the head `<hr/>`. */
function harvestFragmentLabels(html: string): Map<string, string> {
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
function parseRecallKnowledge(raw: string | null): MonsterOutput['recall_knowledge'] {
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
function parsePerception(raw: string | null): MonsterOutput['perception'] {
  if (raw === null) return { modifier: null, senses: [], raw: null };
  const [head, ...tail] = raw.split(';');
  const modifier = asInt(head ?? '');
  const senses = splitTopLevel(tail.join(';').trim(), ',').map((s) => s.trim()).filter((s) => s !== '');
  return { modifier, senses, raw };
}

/** Parse Languages `lang, lang; special` with optional `none (parens)`. */
function parseLanguages(raw: string | null): MonsterOutput['languages'] {
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
function parseSkills(raw: string | null): MonsterOutput['skills'] {
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

/** Six-stat row — values may share one harvested label with the rest embedded. */
function parseAbilityScores(c: CommonExtraction): Record<AbilityScore, number | null> {
  const out: Record<AbilityScore, number | null> = {
    str: null, dex: null, con: null, int: null, wis: null, cha: null,
  };
  for (const name of ABILITY_NAMES) {
    const v = getField(c, name.charAt(0).toUpperCase() + name.slice(1));
    if (v !== null) out[name] = asInt(v);
  }
  for (const f of getAllFields(c, 'Str', 'Dex', 'Con', 'Int', 'Wis', 'Cha')) {
    const re = /<b>\s*(Str|Dex|Con|Int|Wis|Cha)\s*<\/b>\s*([+-]?\d+)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(f.value_html)) !== null) {
      const key = m[1]!.toLowerCase() as AbilityScore;
      const n = parseInt(m[2]!, 10);
      if (Number.isFinite(n)) out[key] = n;
    }
  }
  return out;
}

/** Parse Items as comma-separated linked equipment names. */
function parseItems(raw: string | null): string[] {
  if (raw === null) return [];
  return splitTopLevel(raw, ',').map((s) => s.trim()).filter((s) => s !== '');
}

/** Parse AC `N (M while …)?` plus a separate saves note. */
function parseAc(raw: string | null, savesNote: string | null): MonsterOutput['ac'] {
  if (raw === null) return { value: null, conditional: null, saves_note: savesNote };
  const m = /^\s*(-?\d+)\s*(?:\(([^)]+)\))?/.exec(raw);
  if (m === null) return { value: null, conditional: null, saves_note: savesNote };
  return {
    value: parseInt(m[1]!, 10),
    conditional: m[2] !== undefined ? m[2].trim() : null,
    saves_note: savesNote,
  };
}

/** Parse HP `N (regeneration X)?`. */
function parseHp(raw: string | null): MonsterOutput['hp'] {
  if (raw === null) return { value: null, special: null };
  const m = /^\s*(-?\d+)\s*(?:\(([^)]+)\))?/.exec(raw);
  if (m === null) return { value: null, special: null };
  return { value: parseInt(m[1]!, 10), special: m[2] !== undefined ? m[2].trim() : null };
}

/** Parse Immunities — comma-separated linked types. */
function parseImmunities(raw: string | null): string[] {
  if (raw === null) return [];
  return splitTopLevel(raw, ',').map((s) => s.trim()).filter((s) => s !== '');
}

/** Parse Weaknesses `type N, …`. */
function parseWeaknesses(raw: string | null): MonsterOutput['weaknesses'] {
  if (raw === null) return [];
  const out: MonsterOutput['weaknesses'] = [];
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
function parseResistances(raw: string | null): MonsterOutput['resistances'] {
  if (raw === null) return [];
  const out: MonsterOutput['resistances'] = [];
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

/** Parse Speed `N feet, mode N feet, …`. */
function parseSpeed(raw: string | null): MonsterOutput['speed'] {
  const out: MonsterOutput['speed'] = {
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

/** Parse strike fragments by scanning hanging-indent spans tagged Melee/Ranged. */
function parseStrikes(bodyHtml: string): MonsterStrike[] {
  const out: MonsterStrike[] = [];
  const re = /<span class="hanging-indent">\s*<b>(Melee|Ranged)<\/b>([\s\S]*?)<\/span>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(bodyHtml)) !== null) {
    const kind = match[1]!.toLowerCase() === 'ranged' ? 'ranged' : 'melee';
    out.push(parseStrikeBody(kind, match[2] ?? ''));
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
  let weapon = '';
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

/** Walk an HTML fragment and return the inner HTML of every `<span class="hanging-indent">`. */
function collectHangingIndentInners(html: string): string[] {
  const out: string[] = [];
  const openRe = /<span\s+class="hanging-indent">/gi;
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(html)) !== null) {
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    while (i < html.length && depth > 0) {
      const open = html.indexOf('<span', i);
      const close = html.indexOf('</span>', i);
      if (close === -1) break;
      if (open !== -1 && open < close) { depth++; i = open + 5; }
      else {
        depth--;
        if (depth === 0) { out.push(html.slice(start, close)); openRe.lastIndex = close + 7; break; }
        i = close + 7;
      }
    }
  }
  return out;
}

/** Parse one hanging-indent ability's inner HTML into a MonsterAbility. */
function parseSingleAbility(innerHtml: string): MonsterAbility | null {
  const nameMatch = /<b>\s*([\s\S]*?)\s*<\/b>/i.exec(innerHtml);
  if (nameMatch === null) return null;
  const name = htmlToText(nameMatch[1] ?? '').trim();
  if (name === '' || KNOWN_LABELS.has(name.toLowerCase()) || STAGE_LABEL_RE.test(name) || SPELL_LIST_LABEL_RE.test(name)) {
    return null;
  }
  const action = parseActionGlyph(innerHtml);
  let rest = innerHtml.slice(nameMatch.index + nameMatch[0].length);
  rest = stripActionGlyphs(rest);
  const { traits } = extractLeadingTraits(htmlToText(rest));
  rest = rest.replace(/^\s*\([^)]*\)\s*/, '');

  const frequency = pullLabel(rest, 'Frequency');
  const trigger = pullLabel(rest, 'Trigger');
  const requirements = pullLabel(rest, 'Requirements');
  const effect = pullLabel(rest, 'Effect');

  let saving_throw: MonsterAbility['saving_throw'] = null;
  const stRaw = pullLabel(rest, 'Saving Throw');
  if (stRaw !== null) {
    const dcM = /DC\s+(\d+)/i.exec(stRaw);
    const basic = /\bbasic\b/i.test(stRaw);
    const saveM = /\b(Fortitude|Reflex|Will)\b/i.exec(stRaw);
    let save: SaveName | null = null;
    if (saveM !== null) {
      const s = saveM[1]!.toLowerCase();
      save = s === 'fortitude' ? 'fort' : s === 'reflex' ? 'ref' : 'will';
    }
    if (dcM !== null) saving_throw = { dc: parseInt(dcM[1]!, 10), save, basic };
  }

  const stages: Array<{ stage: number; text: string }> = [];
  const stageRe = /<b>\s*Stage\s+(\d+)\s*<\/b>([\s\S]*?)(?=<b>\s*Stage\s+\d+|$)/gi;
  let sm: RegExpExecArray | null;
  while ((sm = stageRe.exec(rest)) !== null) {
    const stageNum = parseInt(sm[1]!, 10);
    const stageText = htmlToText(sm[2] ?? '').replace(/^[\s;,]+|[\s;,]+$/g, '');
    if (Number.isFinite(stageNum)) stages.push({ stage: stageNum, text: stageText });
  }

  return {
    name, actions: action, traits,
    frequency, trigger, requirements, effect, saving_throw, stages,
    body_html: innerHtml.trim(),
    body_text: htmlToText(innerHtml),
  };
}

/** Extract hanging-indent ability blocks (excluding strikes) from a fragment. */
function parseAbilities(fragmentHtml: string): MonsterAbility[] {
  const out: MonsterAbility[] = [];
  for (const inner of collectHangingIndentInners(fragmentHtml)) {
    if (/^\s*<b>\s*(Melee|Ranged)\s*<\/b>/i.test(inner)) continue;
    const ability = parseSingleAbility(inner);
    if (ability !== null) out.push(ability);
  }
  return out;
}

/** Split body HTML on `<hr/>` into defenses + offense fragments. */
function splitBodySections(bodyHtml: string): { defenses: string; offense: string } {
  const m = /<hr\s*\/?>/i.exec(bodyHtml);
  if (m === null) return { defenses: bodyHtml, offense: '' };
  return { defenses: bodyHtml.slice(0, m.index), offense: bodyHtml.slice(m.index + m[0].length) };
}

/**
 * Extract family group links from `c.links` (which is harvested from the full
 * content span by common.ts, covering both the head and the post-stat-block
 * "Related Groups" section). Deduplicates by name.
 */
function parseFamilyLinks(c: CommonExtraction): Array<{ name: string; family_id: number | null }> {
  const out: Array<{ name: string; family_id: number | null }> = [];
  const seen = new Set<string>();
  for (const link of c.links) {
    if (link.kind !== 'MonsterFamilies') continue;
    if (link.text === '' || seen.has(link.text)) continue;
    seen.add(link.text);
    out.push({ name: link.text, family_id: link.id });
  }
  return out;
}

/** Pull Elite/Normal/Weak/PWL sibling URLs from the variant nav. */
function extractVariants($: CheerioAPI, span: CheerioNode): MonsterOutput['variants'] {
  const out: MonsterOutput['variants'] = [];
  span.find('h2.hide-on-print a').each((_, el) => {
    const $a = $(el);
    const href = $a.attr('href') ?? '';
    if (href === '') return;
    const text = $a.text().trim().toLowerCase();
    const kind = text === 'elite' ? 'elite' : text === 'normal' ? 'normal' : text === 'weak' ? 'weak' : null;
    if (kind !== null) out.push({ kind, url: href });
  });
  span.find('a.monster-pwl-link').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    if (href !== '') out.push({ kind: 'pwl', url: href });
  });
  return out;
}

/** Discover spell-list fields in head + offense fragment. */
function collectSpellLists(c: CommonExtraction, offenseHtml: string): MonsterSpellList[] {
  const out: MonsterSpellList[] = [];
  for (const f of c.fields) {
    if (SPELL_LIST_LABEL_RE.test(f.label)) {
      const list = parseSpellList(f.label, f.value_html);
      if (list !== null) out.push(list);
    }
  }
  for (const line of offenseHtml.split(/<br\s*\/?>/i)) {
    for (const seg of splitOnLabelSemis(line)) {
      const re = /<b>\s*([^<]+?)\s*<\/b>\s*([\s\S]*?)(?=<b>\s*(?:Speed|Melee|Ranged|Damage|AC|Fort|Ref|Will|HP|Hardness|Immunities|Weaknesses|Resistances|Frequency|Trigger|Effect|Requirements|Saving Throw|Stage \d|Items|Cast)\b|$)/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(seg)) !== null) {
        const label = (m[1] ?? '').replace(/:$/, '').trim();
        if (!SPELL_LIST_LABEL_RE.test(label)) continue;
        const list = parseSpellList(label, m[2] ?? '');
        if (list !== null) out.push(list);
      }
    }
  }
  return out;
}

/** Extract a Pathfinder 2e monster stat block from an AON Monsters.aspx page. */
export function extractMonster(c: CommonExtraction, $: CheerioAPI, span: CheerioNode): MonsterOutput {
  const { defenses: defensesHtml, offense: offenseHtml } = splitBodySections(c.body_html);
  const defLabels = harvestFragmentLabels(defensesHtml);
  const offLabels = harvestFragmentLabels(offenseHtml);

  let savesNote: string | null = null;
  const noteMatch = /<b>\s*Will\s*<\/b>\s*[+-]?\d+\s*;\s*([^<]+?)(?=<br|<\/?span|<b>|$)/i.exec(defensesHtml);
  if (noteMatch !== null) {
    const n = htmlToText(noteMatch[1] ?? '').trim();
    if (n !== '' && !/^\+?\d/.test(n)) savesNote = n;
  }

  const ac = parseAc(defLabels.get('ac') ?? null, savesNote);
  const saves: Record<SaveName, number | null> = {
    fort: asInt(defLabels.get('fort') ?? null),
    ref: asInt(defLabels.get('ref') ?? null),
    will: asInt(defLabels.get('will') ?? null),
  };
  const hp = parseHp(defLabels.get('hp') ?? null);
  const hardness = asInt(defLabels.get('hardness') ?? null);
  const immunities = parseImmunities(defLabels.get('immunities') ?? null);
  const weaknesses = parseWeaknesses(defLabels.get('weaknesses') ?? null);
  const resistances = parseResistances(defLabels.get('resistances') ?? null);
  const speed = parseSpeed(offLabels.get('speed') ?? null);

  const strikes = parseStrikes(offenseHtml);
  const spell_lists = collectSpellLists(c, offenseHtml);

  const headHtml = (span.html() ?? '').split(/<hr\s*\/?>/i)[0] ?? '';
  const top_abilities = parseAbilities(headHtml);
  const defensive_abilities = parseAbilities(defensesHtml);
  const offensive_abilities = parseAbilities(offenseHtml);

  const rarity = c.traits.rarity;
  const filterTraits = new Set<string>([
    c.traits.size ?? '',
    c.traits.alignment ?? '',
    rarity.charAt(0).toUpperCase() + rarity.slice(1),
  ]);
  const traits = c.traits.traits.filter((t) => !filterTraits.has(t));

  // Family links from "Related Groups" — sourced from c.links (full content span).
  const family_links = parseFamilyLinks(c);

  return {
    _type: 'monster',
    url: c.url,
    monster_id: extractEntityId(c.url),
    name: c.title.name,
    level: c.title.level,
    rarity,
    size: c.traits.size,
    alignment: c.traits.alignment,
    traits,
    trait_ids: c.traits.trait_ids,
    source: { book: c.source.book, page: c.source.page, source_id: c.source.source_id },
    sources: c.sources,
    alt_edition_url: c.title.alt_edition_url,
    pfs: c.title.pfs,
    recall_knowledge: parseRecallKnowledge(getField(c, 'Recall Knowledge')),
    perception: parsePerception(getField(c, 'Perception')),
    languages: parseLanguages(getField(c, 'Languages')),
    skills: parseSkills(getField(c, 'Skills')),
    abilities: parseAbilityScores(c),
    items: parseItems(getField(c, 'Items')),
    ac,
    saves,
    hp,
    hardness,
    immunities,
    weaknesses,
    resistances,
    speed,
    strikes,
    spell_lists,
    top_abilities,
    defensive_abilities,
    offensive_abilities,
    variants: extractVariants($, span),
    family_links,
    raw_fields: { ...c.field_map },
    links: harvestLinks(c.body_html),
    body_text: c.body_text,
    body_html: c.body_html,
    meta_description: extractMetaDescription($),
    meta_keywords: extractMetaKeywords($),
  };
}
