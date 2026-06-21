/**
 * Ritual concept — parsing helpers.
 *
 * Shared parsing utilities for ritual extraction: parseTraditions, parseRefList,
 * parseFilteredRefList, parseActionCostFromHtml, parseCast, parseSavingThrow,
 * parseDefense, parseOutcomes, parseAffliction, parseHeightened, parseLesson,
 * parseSpoilerSource. Also includes boundary detection (findDescriptionBoundary,
 * findAfflictionStart, readTierBody).
 */
import type { CheerioAPI } from 'cheerio';

import type { CommonExtraction, ActionCost } from '../../common.js';
import {
  getField,
  getFieldHtml,
  htmlToText,
  splitTopLevel,
  asInt,
} from '../../common.js';
import { parseOutcomesBlock } from '../../capabilities/outcomesBlock.js';
import { parseHeightened } from '../../capabilities/heightened.js';

import type {
  SpellKind,
  Tradition,
  SpellOutcome,
  Affliction,
  AfflictionStage,
  HeightenedEntry,
  SpellOutput,
} from './types.js';

export const TRADITIONS: ReadonlySet<Tradition> = new Set(['arcane', 'divine', 'occult', 'primal', 'elemental']);

export const ACTION_LABEL_MAP: ReadonlyMap<string, ActionCost> = new Map<string, ActionCost>([
  ['one-action', 'one-action'],
  ['single-action', 'one-action'],
  ['two-actions', 'two-actions'],
  ['three-actions', 'three-actions'],
  ['reaction', 'reaction'],
  ['free-action', 'free-action'],
]);

export const ORDINAL_MAP: ReadonlyMap<string, number> = new Map<string, number>([
  ['1st', 1], ['2nd', 2], ['3rd', 3], ['4th', 4], ['5th', 5],
  ['6th', 6], ['7th', 7], ['8th', 8], ['9th', 9], ['10th', 10],
]);

/** Resolve the spell `kind` discriminator from a CommonExtraction title block. */
export function resolveKind(common: CommonExtraction): SpellKind {
  const levelKind = (common.title.level_kind ?? '').toLowerCase();
  if (levelKind === 'cantrip') return 'cantrip';
  if (levelKind === 'focus') return 'focus';
  if (levelKind === 'ritual') return 'ritual';
  if (common.page_type === 'ritual') return 'ritual';
  return 'spell';
}

/** Lower-case + filter the Traditions field down to the canonical whitelist. */
export function parseTraditions(common: CommonExtraction): Tradition[] {
  const raw = getField(common, 'Traditions', 'Tradition');
  if (raw === null) return [];
  const out: Tradition[] = [];
  for (const part of splitTopLevel(raw, ',')) {
    const lower = part.toLowerCase().trim();
    if (TRADITIONS.has(lower as Tradition)) out.push(lower as Tradition);
  }
  return out;
}

/** Extract `<a href="…aspx?ID=N">Name</a>` pairs from a value-html fragment. */
export function parseRefList(html: string | null): Array<{ name: string; id: number | null }> {
  if (html === null) return [];
  const out: Array<{ name: string; id: number | null }> = [];
  const regex = /<a[^>]*href="[^"]*\?ID=(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const idStr = match[1] ?? '';
    const inner = match[2] ?? '';
    const name = htmlToText(inner);
    if (name === '') continue;
    const idNum = idStr === '' ? null : parseInt(idStr, 10);
    out.push({ name, id: Number.isFinite(idNum ?? NaN) ? idNum : null });
  }
  return out;
}

/** Extract refs filtered by aspx path from a field HTML value. */
export function parseFilteredRefList(html: string | null, aspxPattern: RegExp): Array<{ name: string; id: number | null }> {
  if (html === null) return [];
  const out: Array<{ name: string; id: number | null }> = [];
  const regex = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const href = match[1] ?? '';
    if (!aspxPattern.test(href)) continue;
    const idMatch = /\?ID=(\d+)/i.exec(href);
    const idNum = idMatch !== null ? parseInt(idMatch[1]!, 10) : null;
    const name = htmlToText(match[2] ?? '');
    if (name === '') continue;
    out.push({ name, id: idNum });
  }
  return out;
}

/** Pull aria-label tokens from any `<span class='action'>` glyph in a fragment. */
export function parseActionCostFromHtml(html: string): ActionCost | null {
  const regex = /<span\s+class=['"]action['"][^>]*aria-label=['"]([^'"]+)['"]/i;
  const match = regex.exec(html);
  if (match === null) return null;
  const lower = (match[1] ?? '').toLowerCase().replace(/\s+/g, '-');
  return ACTION_LABEL_MAP.get(lower) ?? null;
}

/** Parse the heterogeneous `<b>Cast</b>` field — actions + components OR pure duration. */
export function parseCast(common: CommonExtraction): SpellOutput['cast'] {
  const html = getFieldHtml(common, 'Cast');
  if (html === null) return { actions: null, components: [], time: null, raw: null };
  const actions = parseActionCostFromHtml(html);
  const components: string[] = [];
  const compRe = /<a[^>]*href="[^"]*Rules\.aspx\?ID=\d+[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let compMatch: RegExpExecArray | null;
  while ((compMatch = compRe.exec(html)) !== null) {
    const txt = htmlToText(compMatch[1] ?? '');
    if (txt !== '') components.push(txt.toLowerCase());
  }
  const text = htmlToText(html);
  let time: string | null = null;
  if (actions === null && components.length === 0) {
    time = text === '' ? null : text;
  } else if (text !== '') {
    let residual = text;
    for (const comp of components) {
      residual = residual.replace(new RegExp(`\\b${comp}\\b`, 'i'), '');
    }
    residual = residual.replace(/\[[a-z-]+\]/gi, '').replace(/[,;]+/g, ' ').replace(/\s+/g, ' ').trim();
    time = residual === '' ? null : residual;
  }
  return { actions, components, time, raw: text === '' ? null : text };
}

/** Saving Throw breakdown — strip leading "basic " marker and capture the kind. */
export function parseSavingThrow(common: CommonExtraction): SpellOutput['saving_throw'] {
  const raw = getField(common, 'Saving Throw');
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const basic = /^basic\b/i.test(trimmed);
  const kind = basic ? trimmed.replace(/^basic\s+/i, '').trim() : trimmed;
  return { kind: kind === '' ? null : kind, basic, raw: trimmed };
}

/**
 * Parse the `<b>Defense</b>` field present on remaster spell pages.
 * Returns null when the field is absent.
 */
export function parseDefense(common: CommonExtraction): string | null {
  const raw = getField(common, 'Defense');
  if (raw === null || raw.trim() === '') return null;
  return raw.trim();
}

/** Locate the first body boundary that ends the description prose. */
export function findDescriptionBoundary(bodyHtml: string): number {
  const tierRe = /<b>\s*(?:Critical\s+Success|Success|Failure|Critical\s+Failure|Heightened)\s*(?:\([^)]*\))?\s*<\/b>/i;
  const tierM = tierRe.exec(bodyHtml);
  const aff = findAfflictionStart(bodyHtml);
  const candidates: number[] = [];
  if (tierM !== null) candidates.push(tierM.index);
  if (aff !== null) candidates.push(aff.index);
  if (candidates.length === 0) return bodyHtml.length;
  return Math.min(...candidates);
}

interface AfflictionStart {
  index: number;
  end: number;
  name: string;
  type: string;
}

/** Find the inline `<b>Name</b> (type); <b>Level</b> N.` affliction header. */
export function findAfflictionStart(html: string): AfflictionStart | null {
  const regex = /<b>\s*([^<]+?)\s*<\/b>\s*\(([^)]+)\)\s*;\s*<b>\s*Level\s*<\/b>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const type = (match[2] ?? '').toLowerCase().trim();
    if (!/disease|poison|curse|venom|toxin|hex|infection|plague|affliction/.test(type)) continue;
    return { index: match.index, end: match.index + match[0].length, name: (match[1] ?? '').trim(), type };
  }
  return null;
}

/** Sweep the body for save-tier outcomes (`Critical Success` etc.). */
export function parseOutcomes(bodyHtml: string): SpellOutcome {
  return parseOutcomesBlock(bodyHtml);
}

/** Parse an affliction sub-entry into structured stages + optional metadata. */
export function parseAffliction(bodyHtml: string): Affliction | null {
  const start = findAfflictionStart(bodyHtml);
  if (start === null) return null;
  const tail = bodyHtml.slice(start.end);
  const tierRe = /<b>\s*(?:Critical\s+Success|Success|Failure|Critical\s+Failure|Heightened)\b/i;
  const tierM = tierRe.exec(tail);
  const afflictionEnd = tierM === null ? bodyHtml.length : start.end + tierM.index;
  const block = bodyHtml.slice(start.index, afflictionEnd);

  const levelM = /<b>\s*Level\s*<\/b>\s*(\d+)/i.exec(block);
  const level = levelM === null ? null : asInt(levelM[1] ?? '');
  const saveM = /<b>\s*Saving\s+Throw\s*<\/b>\s*([^<;]+)/i.exec(block);
  const onsetM = /<b>\s*Onset\s*<\/b>\s*([^<;]+)/i.exec(block);
  const maxM = /<b>\s*Maximum\s+Duration\s*<\/b>\s*([^<;]+)/i.exec(block);

  const stages: AfflictionStage[] = [];
  const stageRe = /<b>\s*Stage\s+(\d+)\s*<\/b>/gi;
  const matches: Array<{ stage: number; index: number; end: number }> = [];
  let stageMatch: RegExpExecArray | null;
  while ((stageMatch = stageRe.exec(block)) !== null) {
    matches.push({ stage: parseInt(stageMatch[1] ?? '0', 10), index: stageMatch.index, end: stageMatch.index + stageMatch[0].length });
  }
  for (let index = 0; index < matches.length; index++) {
    const cur = matches[index]!;
    const next = matches[index + 1];
    const end = next === undefined ? block.length : next.index;
    const seg = block.slice(cur.end, end);
    const text = htmlToText(seg).replace(/^[\s;]+/, '').replace(/[\s;]+$/, '');
    let duration: string | null = null;
    let body_text = text;
    const durM = /\(([^()]+)\)\s*[;.]?\s*$/.exec(text);
    if (durM !== null) {
      duration = (durM[1] ?? '').trim();
      body_text = text.slice(0, durM.index).trim().replace(/[;.]+$/, '').trim();
    }
    stages.push({ stage: cur.stage, body_text, duration });
  }

  return {
    name: start.name,
    type: start.type === '' ? null : start.type,
    level,
    saving_throw: saveM === null ? null : (saveM[1] ?? '').trim(),
    onset: onsetM === null ? null : (onsetM[1] ?? '').trim(),
    maximum_duration: maxM === null ? null : (maxM[1] ?? '').trim(),
    stages,
    body_html: block,
  };
}

/**
 * Wrap parseHeightened to also check header fields for rare Heightened entries.
 * Most heightened entries are in the body; some pages place them in header fields.
 */
export function parseHeightenedWithFields(bodyHtml: string, fields: CommonExtraction['fields']): HeightenedEntry[] {
  const out = parseHeightened(bodyHtml);
  // Some pages place Heightened in header fields (rare; defensive).
  if (out.length === 0) {
    for (const field of fields) {
      if (!/^heightened\b/i.test(field.label)) continue;
      const labM = /\(([^)]+)\)/.exec(field.label);
      const label = labM === null ? field.label.replace(/^heightened\s*/i, '').trim() : (labM[1] ?? '').trim();
      out.push({
        rank_label: label,
        rank: parseHeightenedRank(label),
        increment: parseHeightenedIncrement(label),
        body_html: field.value_html,
        body_text: field.value_text,
      });
    }
  }
  return out;
}

/** Parse heightened label to extract rank (ordinal or numeric). */
function parseHeightenedRank(label: string): number | null {
  const trimmed = label.trim();
  const incM = /^\+\s*(\d+)$/.exec(trimmed);
  if (incM !== null) return null;
  const ord = ORDINAL_MAP.get(trimmed.toLowerCase());
  if (ord !== undefined) return ord;
  const numM = /^(\d+)/.exec(trimmed);
  if (numM !== null) {
    const num = parseInt(numM[1] ?? '', 10);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

/** Parse heightened label to extract increment. */
function parseHeightenedIncrement(label: string): number | null {
  const trimmed = label.trim();
  const incM = /^\+\s*(\d+)$/.exec(trimmed);
  if (incM !== null) {
    const num = parseInt(incM[1] ?? '', 10);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

/**
 * Extract the `<b>Lesson</b>` field present on witch focus spells.
 * Returns a structured ref with name + Lessons.aspx ID, or null.
 */
export function parseLesson(common: CommonExtraction): SpellOutput['lesson'] {
  const html = getFieldHtml(common, 'Lesson');
  if (html === null) return null;
  const anchorRe = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i;
  const match = anchorRe.exec(html);
  if (match === null) {
    const text = htmlToText(html).trim();
    return text === '' ? null : { name: text, lesson_id: null };
  }
  const idMatch = /\?ID=(\d+)/i.exec(match[1] ?? '');
  const lesson_id = idMatch !== null ? parseInt(idMatch[1]!, 10) : null;
  const name = htmlToText(match[2] ?? '').trim();
  return name === '' ? null : { name, lesson_id };
}

/**
 * Extract the `<h2 class="title">This Spell may contain spoilers from …</h2>`
 * advisory notice. Returns the Adventure Path / product name portion, or null.
 */
export function parseSpoilerSource(root: CheerioAPI): string | null {
  const headings = root('h2.title, h3.title').toArray();
  for (const element of headings) {
    const text = root(element).text().trim();
    if (/^This \w+ may contain spoilers/i.test(text)) return text;
  }
  return null;
}
