/**
 * Spell concept — parsing helpers.
 *
 * Utility functions for parsing spell fields: kinds, traditions, ref lists,
 * action costs, cast fields, saving throws, defense, descriptions, outcomes,
 * afflictions, heightened entries, and lessons.
 */
import type { CheerioAPI } from 'cheerio';

import type { CommonExtraction, CheerioNode } from '../../common.js';
import {
  getField,
  getFieldHtml,
  htmlToText,
  splitTopLevel,
  asInt,
} from '../../common.js';
import { parseOutcomesBlock } from '../../capabilities/outcomesBlock.js';
import { parseHeightened } from '../../capabilities/heightened.js';

import type { ActionCost } from '../../common.js';

import type {
  SpellKind,
  Tradition,
  SpellOutput,
  SpellOutcome,
  Affliction,
  AfflictionStage,
  HeightenedEntry,
} from './types.js';
import { TRADITIONS, ACTION_LABEL_MAP, ORDINAL_MAP } from './types.js';

/** Resolve the spell `kind` discriminator from a CommonExtraction title block. */
export function resolveKind(c: CommonExtraction): SpellKind {
  const lk = (c.title.level_kind ?? '').toLowerCase();
  if (lk === 'cantrip') return 'cantrip';
  if (lk === 'focus') return 'focus';
  if (lk === 'ritual') return 'ritual';
  if (c.page_type === 'ritual') return 'ritual';
  return 'spell';
}

/** Lower-case + filter the Traditions field down to the canonical whitelist. */
export function parseTraditions(c: CommonExtraction): Tradition[] {
  const raw = getField(c, 'Traditions', 'Tradition');
  if (raw === null) return [];
  const out: Tradition[] = [];
  for (const part of splitTopLevel(raw, ',')) {
    const lc = part.toLowerCase().trim();
    if (TRADITIONS.has(lc as Tradition)) out.push(lc as Tradition);
  }
  return out;
}

/** Extract `<a href="…aspx?ID=N">Name</a>` pairs from a value-html fragment. */
export function parseRefList(html: string | null): Array<{ name: string; id: number | null }> {
  if (html === null) return [];
  const out: Array<{ name: string; id: number | null }> = [];
  const re = /<a[^>]*href="[^"]*\?ID=(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const idStr = m[1] ?? '';
    const inner = m[2] ?? '';
    const name = htmlToText(inner);
    if (name === '') continue;
    const id = idStr === '' ? null : parseInt(idStr, 10);
    out.push({ name, id: Number.isFinite(id ?? NaN) ? id : null });
  }
  return out;
}

/** Extract refs filtered by aspx path from a field HTML value. */
export function parseFilteredRefList(html: string | null, aspxPattern: RegExp): Array<{ name: string; id: number | null }> {
  if (html === null) return [];
  const out: Array<{ name: string; id: number | null }> = [];
  const re = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1] ?? '';
    if (!aspxPattern.test(href)) continue;
    const idMatch = /\?ID=(\d+)/i.exec(href);
    const id = idMatch !== null ? parseInt(idMatch[1]!, 10) : null;
    const name = htmlToText(m[2] ?? '');
    if (name === '') continue;
    out.push({ name, id });
  }
  return out;
}

/** Pull aria-label tokens from any `<span class='action'>` glyph in a fragment. */
export function parseActionCostFromHtml(html: string): ActionCost | null {
  const re = /<span\s+class=['"]action['"][^>]*aria-label=['"]([^'"]+)['"]/i;
  const m = re.exec(html);
  if (m === null) return null;
  const lc = (m[1] ?? '').toLowerCase().replace(/\s+/g, '-');
  return ACTION_LABEL_MAP.get(lc) ?? null;
}

/** Parse the heterogeneous `<b>Cast</b>` field — actions + components OR pure duration. */
export function parseCast(c: CommonExtraction): SpellOutput['cast'] {
  const html = getFieldHtml(c, 'Cast');
  if (html === null) return { actions: null, components: [], time: null, raw: null };
  const actions = parseActionCostFromHtml(html);
  const components: string[] = [];
  const compRe = /<a[^>]*href="[^"]*Rules\.aspx\?ID=\d+[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let cm: RegExpExecArray | null;
  while ((cm = compRe.exec(html)) !== null) {
    const txt = htmlToText(cm[1] ?? '');
    if (txt !== '') components.push(txt.toLowerCase());
  }
  const text = htmlToText(html);
  // When no action glyph + no components, treat the raw text as a casting time.
  let time: string | null = null;
  if (actions === null && components.length === 0) {
    time = text === '' ? null : text;
  } else if (text !== '') {
    // Strip recognized component words to leave any trailing duration.
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
export function parseSavingThrow(c: CommonExtraction): SpellOutput['saving_throw'] {
  const raw = getField(c, 'Saving Throw');
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
export function parseDefense(c: CommonExtraction): string | null {
  const raw = getField(c, 'Defense');
  if (raw === null || raw.trim() === '') return null;
  return raw.trim();
}

/** Locate the first body boundary that ends the description prose. */
export function findDescriptionBoundary(bodyHtml: string): number {
  const tierRe = /<b>\s*(?:Critical\s+Success|Success|Failure|Critical\s+Failure|Heightened)\s*(?:\([^)]*\))?\s*<\/b>/i;
  const tierM = tierRe.exec(bodyHtml);
  // Affliction marker: <b>NAME</b> (disease|poison|curse|...);<b>Level</b> N.
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
function findAfflictionStart(html: string): AfflictionStart | null {
  const re = /<b>\s*([^<]+?)\s*<\/b>\s*\(([^)]+)\)\s*;\s*<b>\s*Level\s*<\/b>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const type = (m[2] ?? '').toLowerCase().trim();
    if (!/disease|poison|curse|venom|toxin|hex|infection|plague|affliction/.test(type)) continue;
    return { index: m.index, end: m.index + m[0].length, name: (m[1] ?? '').trim(), type };
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
  // Affliction body extends until the first save-tier marker, Heightened, or end.
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
  let sm: RegExpExecArray | null;
  while ((sm = stageRe.exec(block)) !== null) {
    matches.push({ stage: parseInt(sm[1] ?? '0', 10), index: sm.index, end: sm.index + sm[0].length });
  }
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i]!;
    const next = matches[i + 1];
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
    for (const f of fields) {
      if (!/^heightened\b/i.test(f.label)) continue;
      const labM = /\(([^)]+)\)/.exec(f.label);
      const label = labM === null ? f.label.replace(/^heightened\s*/i, '').trim() : (labM[1] ?? '').trim();
      out.push({
        rank_label: label,
        rank: parseHeightenedRank(label),
        increment: parseHeightenedIncrement(label),
        body_html: f.value_html,
        body_text: f.value_text,
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
    const n = parseInt(numM[1] ?? '', 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Parse heightened label to extract increment. */
function parseHeightenedIncrement(label: string): number | null {
  const trimmed = label.trim();
  const incM = /^\+\s*(\d+)$/.exec(trimmed);
  if (incM !== null) {
    const n = parseInt(incM[1] ?? '', 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Extract the `<b>Lesson</b>` field present on witch focus spells.
 * Returns a structured ref with name + Lessons.aspx ID, or null.
 */
export function parseLesson(c: CommonExtraction): SpellOutput['lesson'] {
  const html = getFieldHtml(c, 'Lesson');
  if (html === null) return null;
  const anchorRe = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i;
  const m = anchorRe.exec(html);
  if (m === null) {
    const text = htmlToText(html).trim();
    return text === '' ? null : { name: text, lesson_id: null };
  }
  const idMatch = /\?ID=(\d+)/i.exec(m[1] ?? '');
  const lesson_id = idMatch !== null ? parseInt(idMatch[1]!, 10) : null;
  const name = htmlToText(m[2] ?? '').trim();
  return name === '' ? null : { name, lesson_id };
}

/**
 * Extract the `<h2 class="title">This Spell may contain spoilers from …</h2>`
 * advisory notice. Returns the Adventure Path / product name portion, or null.
 */
export function parseSpoilerSource($: CheerioAPI): string | null {
  const headings = $('h2.title, h3.title').toArray();
  for (const el of headings) {
    const text = $(el).text().trim();
    if (/^This \w+ may contain spoilers/i.test(text)) return text;
  }
  return null;
}
