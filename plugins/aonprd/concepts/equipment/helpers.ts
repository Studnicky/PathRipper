/**
 * Equipment concept — shared parsing helpers.
 *
 * Exports: isDash, dashToNull, parsePrice, parseBulk, parseDamage, parseRange,
 * parseTraitGlossary, buildDescription, readGroupAnchor, parseActivation,
 * parseFavoredWeapon, parseCriticalSpec, parseSpecificMagicWeapons.
 */
import type { CheerioAPI } from 'cheerio';
import type { CommonExtraction, CheerioNode } from '../../common.js';
import {
  htmlToText,
  asInt,
  splitTopLevel,
} from '../../common.js';
import type { ActionCost } from '../../common.js';
import type { DamageParts, PriceParts, Activation } from './types.private.js';

const DASH_RE = /^(?:—|–|-|&mdash;|&ndash;)$/;

export function isDash(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  const t = value.trim();
  return t === '' || DASH_RE.test(t);
}

export function dashToNull(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed === '' || DASH_RE.test(trimmed)) return null;
  return trimmed;
}

/** Parse a price string like `1 gp, 5 sp` into structured coin counts. */
export function parsePrice(raw: string | null): PriceParts {
  if (raw === null || isDash(raw)) return { gp: null, sp: null, cp: null, raw: null };
  const text = raw.trim();
  // Allow comma-separated numerals like "3,000 gp".
  let gp: number | null = null, sp: number | null = null, cp: number | null = null;
  const re = /([\d,]+)\s*(gp|sp|cp)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = parseInt((m[1] ?? '').replace(/,/g, ''), 10);
    if (!Number.isFinite(n)) continue;
    const unit = (m[2] ?? '').toLowerCase();
    if (unit === 'gp') gp = n;
    else if (unit === 'sp') sp = n;
    else if (unit === 'cp') cp = n;
  }
  return { gp, sp, cp, raw: text };
}

/** Bulk: 'L' literal, integer numeric, or null on em-dash. */
export function parseBulk(raw: string | null): 'L' | number | null {
  if (raw === null || isDash(raw)) return null;
  const t = raw.trim();
  if (/^L$/i.test(t)) return 'L';
  const n = asInt(t);
  return n;
}

/** Parse `1d8 S`, `1d4 P plus 1d4 fire`, etc. Em-dash → null. */
export function parseDamage(raw: string | null): DamageParts | null {
  if (raw === null || isDash(raw)) return null;
  const t = raw.trim();
  // Dice token + optional damage type + optional rider tail.
  const m = /^(\d+d\d+(?:\s*[+-]\s*\d+)?)\s*([BPS])?\s*(.*)$/i.exec(t);
  if (m === null) return null;
  const dice = (m[1] ?? '').replace(/\s+/g, '');
  const typeToken = (m[2] ?? '').toUpperCase();
  const type: 'B' | 'P' | 'S' | null = typeToken === 'B' || typeToken === 'P' || typeToken === 'S' ? typeToken : null;
  const riderRaw = (m[3] ?? '').trim();
  const rider = riderRaw === '' ? null : riderRaw;
  return { dice, type, rider };
}

/** Parse `30 feet` → `{feet:30}`; em-dash → null. */
export function parseRange(raw: string | null): { feet: number } | null {
  if (raw === null || isDash(raw)) return null;
  const m = /(\d+)\s*feet/i.exec(raw);
  if (m === null) return null;
  const n = parseInt(m[1]!, 10);
  return Number.isFinite(n) ? { feet: n } : null;
}

/** Parse weapon hands field: '1', '2', or '1+'. */
export function parseWeaponHands(raw: string | null): '1' | '2' | '1+' | null {
  if (raw === null || isDash(raw)) return null;
  const t = raw.trim();
  if (t === '1') return '1';
  if (t === '2') return '2';
  if (t === '1+' || /^1\s*\+/.test(t)) return '1+';
  return null;
}

/** Parse trait-entry glossary blocks (`<div class="trait-entry">`). */
export function parseTraitGlossary($: CheerioAPI, span: CheerioNode): Array<{ trait: string; description: string }> {
  const out: Array<{ trait: string; description: string }> = [];
  span.find('div.trait-entry').each((_, el) => {
    const html = $(el).html() ?? '';
    const m = /<b>\s*([^<]+?)\s*<\/b>([\s\S]*)/i.exec(html);
    if (m === null) return;
    const trait = (m[1] ?? '').replace(/:$/, '').trim();
    const description = htmlToText(m[2] ?? '');
    if (trait === '') return;
    out.push({ trait, description });
  });
  return out;
}

/** Slice a description: body before the first `<h2 class="title">` subsection. */
export function buildDescription(bodyHtml: string): { html: string; text: string } {
  const m = /<h2\s+class="title"/i.exec(bodyHtml);
  const before = m === null ? bodyHtml : bodyHtml.slice(0, m.index);
  return { html: before.trim(), text: htmlToText(before) };
}

/** Find the AON anchor href + id pair embedded in a field's HTML value. */
export function readGroupAnchor(valueHtml: string | null, kindHint: RegExp): { name: string; group_id: number | null } | null {
  if (valueHtml === null) return null;
  if (isDash(htmlToText(valueHtml))) return null;
  const m = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(valueHtml);
  if (m === null) {
    // Plain-text group fallback.
    const txt = htmlToText(valueHtml);
    return txt === '' ? null : { name: txt, group_id: null };
  }
  const href = m[1] ?? '';
  if (!kindHint.test(href)) {
    const txt = htmlToText(valueHtml);
    return txt === '' ? null : { name: txt, group_id: null };
  }
  const idMatch = /\?ID=(\d+)/i.exec(href);
  const group_id = idMatch !== null ? parseInt(idMatch[1]!, 10) : null;
  const name = htmlToText(m[2] ?? '');
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
    const lm = ACTION_GLYPH_RE.exec(inner);
    if (lm === null) continue;
    const cost = ACTION_LABEL_TO_COST.get((lm[1] ?? '').toLowerCase());
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
      const lc = part.toLowerCase().replace(/\s+/g, ' ').trim();
      if (lc !== '') components.push(lc);
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
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(valueHtml)) !== null) {
    const href = m[1] ?? '';
    if (!/Deities\.aspx/i.test(href)) continue;
    const idMatch = /\?ID=(\d+)/i.exec(href);
    const deity_id = idMatch !== null ? parseInt(idMatch[1]!, 10) : null;
    const deity = htmlToText(m[2] ?? '');
    if (deity === '') continue;
    out.push({ deity, deity_id });
  }
  return out;
}

/** Parse weapon Critical Specialization Effects subsection. */
export function parseCriticalSpec(c: CommonExtraction): { source: string | null; by_group: Record<string, string> } | null {
  const section = c.sections.find((s) => /^Critical Specialization Effects$/i.test(s.heading));
  if (section === undefined) return null;
  const html = section.body_html;
  // Source label pulled into its own slot.
  const sourceMatch = /<b>\s*Source\s*<\/b>\s*<a[^>]*>\s*<i>([^<]+)<\/i>\s*<\/a>(?:\s*pg\.\s*\d+)?/i.exec(html);
  const source = sourceMatch !== null ? (sourceMatch[1] ?? '').trim() : null;
  // Group-keyed lines: `<b>Brawling</b>: text`.
  const by_group: Record<string, string> = {};
  const groupRe = /<b>\s*([^<]+?)\s*<\/b>\s*:?\s*([^<]*(?:<a[^>]*>[^<]*<\/a>[^<]*)*)/gi;
  let m: RegExpExecArray | null;
  while ((m = groupRe.exec(html)) !== null) {
    const label = (m[1] ?? '').trim();
    if (/^source$/i.test(label)) continue;
    const valueText = htmlToText(m[2] ?? '');
    if (label === '' || valueText === '') continue;
    if (!(label in by_group)) by_group[label] = valueText;
  }
  return { source, by_group };
}

/** Parse Specific Magic Weapons subsection (anchor list). */
export function parseSpecificMagicWeapons(c: CommonExtraction): Array<{ name: string; equipment_id: number | null }> {
  const section = c.sections.find((s) => /^Specific Magic Weapons$/i.test(s.heading));
  if (section === undefined) return [];
  const out: Array<{ name: string; equipment_id: number | null }> = [];
  for (const link of section.links) {
    if (!/Equipment\.aspx/i.test(link.href)) continue;
    out.push({ name: link.text, equipment_id: link.id });
  }
  return out;
}
