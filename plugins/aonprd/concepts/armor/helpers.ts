// Shared helpers for armor, weapon, and equipment extraction.

import type { CheerioAPI } from 'cheerio';

import type { CommonExtraction, CheerioNode } from '../../common.js';
import { htmlToText, splitTopLevel, asInt } from '../../common.js';
import type { ActionCost } from '../../common.js';
import type { Activation } from './types.js';

// ─── Shared parsing helpers ───────────────────────────────────────────────────

const DASH_RE = /^(?:—|–|-|&mdash;|&ndash;)$/;

export function isDash(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  const str = value.trim();
  return str === '' || DASH_RE.test(str);
}

export function dashToNull(value: string | null): string | null {
  if (value === null) return null;
  const str = value.trim();
  if (str === '' || DASH_RE.test(str)) return null;
  return str;
}

interface PriceParts {
  gp: number | null; sp: number | null; cp: number | null; raw: string | null;
}

/** Parse a price string like `1 gp, 5 sp` into structured coin counts. */
export function parsePrice(raw: string | null): PriceParts {
  if (raw === null || isDash(raw)) return { gp: null, sp: null, cp: null, raw: null };
  const text = raw.trim();
  // Allow comma-separated numerals like "3,000 gp".
  let gpl: number | null = null, spl: number | null = null, cpl: number | null = null;
  const regex = /([\d,]+)\s*(gp|sp|cp)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const num = parseInt((match[1] ?? '').replace(/,/g, ''), 10);
    if (!Number.isFinite(num)) continue;
    const unit = (match[2] ?? '').toLowerCase();
    if (unit === 'gp') gpl = num;
    else if (unit === 'sp') spl = num;
    else if (unit === 'cp') cpl = num;
  }
  return { gp: gpl, sp: spl, cp: cpl, raw: text };
}

/** Bulk: 'L' literal, integer numeric, or null on em-dash. */
export function parseBulk(raw: string | null): 'L' | number | null {
  if (raw === null || isDash(raw)) return null;
  const str = raw.trim();
  if (/^L$/i.test(str)) return 'L';
  const num = asInt(str);
  return num;
}

interface DamageParts {
  dice: string; type: 'B' | 'P' | 'S' | null; rider: string | null;
}

/** Parse `1d8 S`, `1d4 P plus 1d4 fire`, etc. Em-dash → null. */
export function parseDamage(raw: string | null): DamageParts | null {
  if (raw === null || isDash(raw)) return null;
  const str = raw.trim();
  // Dice token + optional damage type + optional rider tail.
  const match = /^(\d+d\d+(?:\s*[+-]\s*\d+)?)\s*([BPS])?\s*(.*)$/i.exec(str);
  if (match === null) return null;
  const dice = (match[1] ?? '').replace(/\s+/g, '');
  const typeToken = (match[2] ?? '').toUpperCase();
  const type: 'B' | 'P' | 'S' | null = typeToken === 'B' || typeToken === 'P' || typeToken === 'S' ? typeToken : null;
  const riderRaw = (match[3] ?? '').trim();
  const rider = riderRaw === '' ? null : riderRaw;
  return { dice, type, rider };
}

/** Parse `30 feet` → `{feet:30}`; em-dash → null. */
export function parseRange(raw: string | null): { feet: number } | null {
  if (raw === null || isDash(raw)) return null;
  const match = /(\d+)\s*feet/i.exec(raw);
  if (match === null) return null;
  const num = parseInt(match[1]!, 10);
  return Number.isFinite(num) ? { feet: num } : null;
}

/** Parse trait-entry glossary blocks (`<div class="trait-entry">`). */
export function parseTraitGlossary(root: CheerioAPI, span: CheerioNode): Array<{ trait: string; description: string }> {
  const out: Array<{ trait: string; description: string }> = [];
  span.find('div.trait-entry').each((_index, element) => {
    const html = root(element).html() ?? '';
    const match = /<b>\s*([^<]+?)\s*<\/b>([\s\S]*)/i.exec(html);
    if (match === null) return;
    const trait = (match[1] ?? '').replace(/:$/, '').trim();
    const description = htmlToText(match[2] ?? '');
    if (trait === '') return;
    out.push({ trait, description });
  });
  return out;
}

/** Slice a description: body before the first `<h2 class="title">` subsection. */
export function buildDescription(bodyHtml: string): { html: string; text: string } {
  const match = /<h2\s+class="title"/i.exec(bodyHtml);
  const before = match === null ? bodyHtml : bodyHtml.slice(0, match.index);
  return { html: before.trim(), text: htmlToText(before) };
}

/** Find the AON anchor href + id pair embedded in a field's HTML value. */
export function readGroupAnchor(valueHtml: string | null, kindHint: RegExp): { name: string; group_id: number | null } | null {
  if (valueHtml === null) return null;
  if (isDash(htmlToText(valueHtml))) return null;
  const match = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(valueHtml);
  if (match === null) {
    // Plain-text group fallback.
    const txt = htmlToText(valueHtml);
    return txt === '' ? null : { name: txt, group_id: null };
  }
  const href = match[1] ?? '';
  if (!kindHint.test(href)) {
    const txt = htmlToText(valueHtml);
    return txt === '' ? null : { name: txt, group_id: null };
  }
  const idMatch = /\?ID=(\d+)/i.exec(href);
  const group_id = idMatch !== null ? parseInt(idMatch[1]!, 10) : null;
  const name = htmlToText(match[2] ?? '');
  return { name, group_id };
}

const ACTION_GLYPH_RE = /\[([a-z-]+)\]/i;

const ACTION_LABEL_TO_COST: ReadonlyMap<string, ActionCost> = new Map<string, ActionCost>([
  ['one-action',     'one-action'],
  ['single-action',  'one-action'],
  ['two-actions',    'two-actions'],
  ['three-actions',  'three-actions'],
  ['reaction',       'reaction'],
  ['free-action',    'free-action'],
]);

/** Parse `Activate` field HTML for action glyphs and `(component, …)` lists. */
export function parseActivation(valueHtml: string): Activation {
  // Action glyph (first occurrence wins, additional glyphs imply variable cost).
  const glyphRe = /<span\s+class=['"]action['"][^>]*>([\s\S]*?)<\/span>/gi;
  let glyphMatch: RegExpExecArray | null;
  const costs: ActionCost[] = [];
  while ((glyphMatch = glyphRe.exec(valueHtml)) !== null) {
    const inner = glyphMatch[1] ?? '';
    const lastMatch = ACTION_GLYPH_RE.exec(inner);
    if (lastMatch === null) continue;
    const cost = ACTION_LABEL_TO_COST.get((lastMatch[1] ?? '').toLowerCase());
    if (cost !== undefined) costs.push(cost);
  }
  let action_cost: ActionCost | null = null;
  if (costs.length === 1) action_cost = costs[0]!;
  else if (costs.length > 1) action_cost = 'variable';

  // Components in trailing parentheses, e.g. `(manipulate, command)`.
  const components: string[] = [];
  const compMatch = /\(([^()]+)\)/.exec(htmlToText(valueHtml));
  if (compMatch !== null) {
    for (const part of splitTopLevel(compMatch[1] ?? '', ',')) {
      const lastChunk = part.toLowerCase().replace(/\s+/g, ' ').trim();
      if (lastChunk !== '') components.push(lastChunk);
    }
  }

  // Free-form remainder text (sans glyphs and parens) — null when nothing left.
  const noGlyphs = valueHtml.replace(/<span\s+class=['"]action['"][\s\S]*?<\/span>/gi, '');
  const noParens = htmlToText(noGlyphs).replace(/\([^()]*\)/g, '').replace(/\s+/g, ' ').trim();
  const text = noParens === '' ? null : noParens;

  return { action_cost, components, text };
}

/** Parse `Favored Weapon` field for deity links. */
export function parseFavoredWeapon(valueHtml: string | null): Array<{ deity: string; deity_id: number | null }> {
  if (valueHtml === null) return [];
  const out: Array<{ deity: string; deity_id: number | null }> = [];
  const anchorRe = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorRe.exec(valueHtml)) !== null) {
    const href = match[1] ?? '';
    if (!/Deities\.aspx/i.test(href)) continue;
    const idMatch = /\?ID=(\d+)/i.exec(href);
    const deity_id = idMatch !== null ? parseInt(idMatch[1]!, 10) : null;
    const deity = htmlToText(match[2] ?? '');
    if (deity === '') continue;
    out.push({ deity, deity_id });
  }
  return out;
}

/** Parse weapon Critical Specialization Effects subsection. */
export function parseCriticalSpec(common: CommonExtraction): { source: string | null; by_group: Record<string, string> } | null {
  const section = common.sections.find((sec) => /^Critical Specialization Effects$/i.test(sec.heading));
  if (section === undefined) return null;
  const html = section.body_html;
  // Source label pulled into its own slot.
  const sourceMatch = /<b>\s*Source\s*<\/b>\s*<a[^>]*>\s*<i>([^<]+)<\/i>\s*<\/a>(?:\s*pg\.\s*\d+)?/i.exec(html);
  const source = sourceMatch !== null ? (sourceMatch[1] ?? '').trim() : null;
  // Group-keyed lines: `<b>Brawling</b>: text`.
  const by_group: Record<string, string> = {};
  const groupRe = /<b>\s*([^<]+?)\s*<\/b>\s*:?\s*([^<]*(?:<a[^>]*>[^<]*<\/a>[^<]*)*)/gi;
  let match: RegExpExecArray | null;
  while ((match = groupRe.exec(html)) !== null) {
    const label = (match[1] ?? '').trim();
    if (/^source$/i.test(label)) continue;
    const valueText = htmlToText(match[2] ?? '');
    if (label === '' || valueText === '') continue;
    if (!(label in by_group)) by_group[label] = valueText;
  }
  return { source, by_group };
}

/** Parse Specific Magic Weapons subsection (anchor list). */
export function parseSpecificMagicWeapons(common: CommonExtraction): Array<{ name: string; equipment_id: number | null }> {
  const section = common.sections.find((sec) => /^Specific Magic Weapons$/i.test(sec.heading));
  if (section === undefined) return [];
  const out: Array<{ name: string; equipment_id: number | null }> = [];
  for (const link of section.links) {
    if (!/Equipment\.aspx/i.test(link.href)) continue;
    out.push({ name: link.text, equipment_id: link.id });
  }
  return out;
}
