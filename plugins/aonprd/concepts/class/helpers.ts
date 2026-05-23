// Class parsing helpers.

import type { CommonExtraction } from '../../common.js';
import {
  getField,
  asInt,
  htmlToText,
  loadFragment,
} from '../../common.js';

/**
 * Parse `<b>Label: VALUE</b>` — modern AON class pages embed key mechanics
 * inline with the colon inside the `<b>` tag.
 */
export function readInlineBoldLabel(html: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<b>\\s*${escaped}\\s*:\\s*([^<]+?)</b>`, 'i');
  const m = re.exec(html);
  if (m === null) return null;
  return htmlToText(m[1] ?? '');
}

/**
 * Extract Initial Proficiencies as a category-keyed map.
 *
 * On modern pages the container is `<h1 class="title">Initial Proficiencies</h1>`
 * with `<h2 class="title">Category</h2>VALUE` rows underneath. Legacy pages
 * fall back to `<b>Category</b>VALUE` pairs inside the same container.
 */
export function extractInitialProficiencies(fullHtml: string): Record<string, string> {
  const out: Record<string, string> = {};
  const initProfRe = /<h1[^>]+class="title"[^>]*>\s*Initial Proficiencies\s*<\/h1>([\s\S]*?)(?=<h1[^>]+class="title"|$)/i;
  const m = initProfRe.exec(fullHtml);
  if (m === null) return out;
  const inner = m[1] ?? '';

  const h2Re = /<h2[^>]+class="title"[^>]*>\s*([^<]+?)\s*<\/h2>\s*([\s\S]*?)(?=<h[123]|$)/gi;
  let h2m: RegExpExecArray | null;
  while ((h2m = h2Re.exec(inner)) !== null) {
    const k = (h2m[1] ?? '').trim();
    const v = htmlToText(h2m[2] ?? '');
    if (k !== '' && v !== '' && !(k in out)) out[k] = v;
  }

  if (Object.keys(out).length === 0) {
    const bRe = /<b>\s*([^<]+?)\s*<\/b>\s*([\s\S]*?)(?=<b>|<h[1-6]|$)/gi;
    let bm: RegExpExecArray | null;
    while ((bm = bRe.exec(inner)) !== null) {
      const k = (bm[1] ?? '').replace(/:$/, '').trim();
      const v = htmlToText(bm[2] ?? '');
      if (k !== '' && v !== '' && !(k in out)) out[k] = v;
    }
  }

  return out;
}

/**
 * Parse the concatenated `Class Features` orphan string into per-level
 * structured progression.
 */
export function parseClassFeaturesProgression(raw: string | null): Array<{ level: number; features: string[] }> {
  if (raw === null || raw.trim() === '') return [];
  const out: Array<{ level: number; features: string[] }> = [];

  const chunkRe = /(\d+)([^\d]+)/g;
  let m: RegExpExecArray | null;
  let lastLevel = 0;
  while ((m = chunkRe.exec(raw)) !== null) {
    const level = parseInt(m[1]!, 10);
    if (!Number.isFinite(level) || level < 1 || level > 20) continue;
    if (level !== lastLevel + 1) continue;
    lastLevel = level;
    out.push({ level, features: splitFeatureList(m[2] ?? '', level === 20) });
  }
  return out;
}

/**
 * Split a level's feature prose into individual feature names.
 */
function splitFeatureList(text: string, isLastLevel: boolean): string[] {
  const parts = text.split(',').map((p) => p.trim()).filter((p) => p !== '');
  if (parts.length === 0) return [];
  if (!isLastLevel) return parts;

  const last = parts[parts.length - 1]!;
  const seamRe = /[a-z]\s*[A-Z]/;
  const seam = seamRe.exec(last);
  if (seam === null) return parts;
  const truncated = last.slice(0, seam.index + 1).trim();
  if (truncated === '') return parts.slice(0, parts.length - 1);
  parts[parts.length - 1] = truncated;
  return parts;
}

/**
 * Discover subclass nav entries from `<h3>` sections in the Class Features
 * subtree.
 */
export function extractSubclasses(sections: ReadonlyArray<any>): Array<{ name: string; description: string }> {
  const out: Array<{ name: string; description: string }> = [];
  for (const s of sections) {
    if (s.level !== 3) continue;
    if (/Bomber|Chirurgeon|Mutagenist|Toxicologist|^[A-Z][a-z]+$/.test(s.heading)
        && /research field|methodology/i.test(s.body_text)) {
      out.push({ name: s.heading, description: s.body_text });
    }
  }
  return out;
}

const NON_SUBCLASS_LABELS: ReadonlySet<string> = new Set<string>([
  'usage', 'bulk', 'activate', 'access', 'price', 'hands', 'category', 'group',
  'damage', 'range', 'reload', 'ammunition', 'duration', 'cost', 'cast',
  'requirements', 'trigger', 'effect', 'frequency', 'area', 'defense', 'target',
  'targets', 'saving throw', 'level', 'traditions', 'tradition', 'item', 'type',
  'archetype', 'prerequisites', 'related sources', 'related source',
  'spoiler warning',
  'cantrips',
  '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th',
  '1st-level spells', '2nd-level spells', '3rd-level spells', '4th-level spells',
  '5th-level spells', '6th-level spells', '7th-level spells', '8th-level spells',
  '9th-level spells', '10th-level spells',
  'alchemical item formulas', 'dragon empires zodiac', 'made of an element',
  'overlapping kinetic auras',
]);

/**
 * Predicate identifying field labels that look like subclass names.
 */
export function isSubclassLabel(label: string, claimed: ReadonlySet<string>): boolean {
  if (label.includes(':')) return false;
  const lc = label.toLowerCase();
  if (claimed.has(lc)) return false;
  if (NON_SUBCLASS_LABELS.has(lc)) return false;
  if (!/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?$/.test(label)) return false;
  return true;
}

/**
 * Extract subclass-feature labels from bare `<b>` tags in the head HTML.
 */
export function extractSubclassFeaturesFromHead(headHtml: string, claimedLabels: Set<string>): Array<{ name: string; description: string }> {
  const out: Array<{ name: string; description: string }> = [];
  const seen = new Set<string>();
  if (headHtml.trim() === '') return out;
  const $h = loadFragment(headHtml, 'head-root');

  $h('#head-root b').each((_, el) => {
    const $b = $h(el);
    if ($b.children().length > 0) return;
    if ($b.parents('a').length > 0) return;
    if ($b.closest('h1, h2, h3').length > 0) return;

    const rawName = $b.text().trim().replace(/:$/, '');
    if (rawName === '') return;
    const beforeColon = rawName.split(':')[0]!.trim();
    if (claimedLabels.has(beforeColon.toLowerCase())) return;
    if (rawName.includes(':')) return;
    if (!/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?$/.test(rawName)) return;
    if (seen.has(rawName)) return;

    let cur: ReturnType<typeof $h> | null = $b.next();
    let descHtml = '';
    while (cur !== null && cur.length > 0) {
      const node = cur[0]!;
      if (node.type === 'tag') {
        const tagName = ('name' in node && typeof node.name === 'string') ? node.name.toLowerCase() : '';
        if (tagName === 'b' || tagName === 'br' || tagName === 'hr') break;
      }
      descHtml += $h.html(cur as ReturnType<typeof $h>);
      cur = cur.next();
    }
    const description = htmlToText(descHtml).trim();
    if (description === '') return;
    seen.add(rawName);
    out.push({ name: rawName, description });
  });

  return out;
}

/** Compute the head HTML fragment — everything before the first `<hr/>`. */
export function getHeadHtml(bodyHtml: string): string {
  return bodyHtml.split(/<hr\s*\/?>/i)[0] ?? '';
}
