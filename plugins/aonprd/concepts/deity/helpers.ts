// Deity parsing helpers.

import type { CommonExtraction } from '../../common.js';
import {
  htmlToText,
  splitTopLevel,
} from '../../common.js';
import type {
  DeityClericSpellRank,
  DeityIntercession,
  DeityRelationship,
} from './types.js';

/**
 * Harvest `<b>Label</b> Value` pairs from a fragment, supporting labels that
 * wrap an inner `<a>` (e.g. `<b><a href="…">Divine Attribute</a></b>`).
 *
 * Returns a case-insensitive Map keyed by the inner text of the `<b>`, with
 * value capturing all text up to the next `<b>` boundary or end of fragment.
 * `<br>` separators are tolerated by the lookahead — they don't terminate the
 * value.
 */
export function harvestLinkedBoldLabels(html: string): Map<string, string> {
  const out = new Map<string, string>();
  // Match <b>…</b> (allowing nested tags inside the label) followed by value
  // text up to the next <b> or end. The label inner is htmlToText'd to flatten
  // anchor wrappers like <b><a>Divine Attribute</a></b>.
  const regex = /<b>([\s\S]*?)<\/b>([\s\S]*?)(?=<b>|<h[1-6]\b|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const labelHtml = match[1] ?? '';
    const valueHtml = match[2] ?? '';
    const label = htmlToText(labelHtml).replace(/[:?]$/, '').trim();
    if (label === '') continue;
    const value = htmlToText(valueHtml).replace(/^[\s;,:]+|[\s;,]+$/g, '');
    if (value === '') continue;
    const key = label.toLowerCase();
    if (!out.has(key)) out.set(key, value);
  }
  return out;
}

/**
 * Harvest `<b>Label</b> Value` pairs preserving each value's verbatim HTML for
 * downstream parsers that need to walk anchors (domains, cleric spells, etc.).
 */
export function harvestLinkedBoldLabelsHtml(html: string): Map<string, string> {
  const out = new Map<string, string>();
  const regex = /<b>([\s\S]*?)<\/b>([\s\S]*?)(?=<b>|<h[1-6]\b|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const labelHtml = match[1] ?? '';
    const valueHtml = match[2] ?? '';
    const label = htmlToText(labelHtml).replace(/[:?]$/, '').trim();
    if (label === '') continue;
    const key = label.toLowerCase();
    if (!out.has(key)) out.set(key, valueHtml.trim());
  }
  return out;
}

/**
 * Locate the section body for a heading, falling back to `c.body_html` when
 * no matching section is present. Used by per-slice helpers so a deity page
 * missing "Devotee Benefits" still produces null values rather than null
 * sections.
 */
export function findSectionBody(common: CommonExtraction, heading: string): string {
  const target = heading.toLowerCase();
  for (const section of common.sections) {
    if (section.heading.toLowerCase() === target) return section.body_html;
  }
  return '';
}

/** Parse a comma-separated linked-anchor list into trimmed names. */
export function parseLinkedList(raw: string | null): string[] {
  if (raw === null || raw.trim() === '') return [];
  return splitTopLevel(raw, ',').map((str) => str.trim()).filter((str) => str !== '');
}

/**
 * Parse the `Cleric Spells` value HTML into rank-indexed spell groups.
 *
 * AON renders this as `1st: <i><a>name</a></i>, 4th: <i><a>name</a></i>, …`.
 * We split on the rank tokens (e.g. `1st:`, `4th:`) and harvest the spell
 * names from each chunk.
 */
const RANK_RE = /(\d+)(?:st|nd|rd|th)\s*:/gi;

export function parseClericSpells(valueHtml: string | null): DeityClericSpellRank[] {
  if (valueHtml === null) return [];
  const text = htmlToText(valueHtml);
  if (text === '') return [];

  const rankMatches: Array<{ rank: number; start: number; end: number }> = [];
  RANK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = RANK_RE.exec(text)) !== null) {
    const rank = parseInt(match[1]!, 10);
    if (Number.isFinite(rank)) {
      rankMatches.push({ rank, start: match.index, end: match.index + match[0].length });
    }
  }
  if (rankMatches.length === 0) return [];

  const out: DeityClericSpellRank[] = [];
  for (let index = 0; index < rankMatches.length; index++) {
    const cur = rankMatches[index]!;
    const next = index + 1 < rankMatches.length ? rankMatches[index + 1]!.start : text.length;
    const segment = text.slice(cur.end, next).trim().replace(/[,;]\s*$/, '');
    const spells = splitTopLevel(segment, ',').map((str) => str.trim()).filter((str) => str !== '');
    out.push({ rank: cur.rank, spells });
  }
  return out;
}

/**
 * Parse intercession boon/curse entries from the Divine Intercession section.
 *
 * AON uses `<b>Minor Boon</b>:` / `<b>Moderate Curse</b>:` headers with prose
 * text following until the next bold tier label or end of section.
 */
const INTERCESSION_TIERS: ReadonlyArray<{ label: string; tier: DeityIntercession['tier']; kind: DeityIntercession['kind'] }> = [
  { label: 'minor boon',      tier: 'minor',    kind: 'boon'  },
  { label: 'moderate boon',   tier: 'moderate', kind: 'boon'  },
  { label: 'major boon',      tier: 'major',    kind: 'boon'  },
  { label: 'minor curse',     tier: 'minor',    kind: 'curse' },
  { label: 'moderate curse',  tier: 'moderate', kind: 'curse' },
  { label: 'major curse',     tier: 'major',    kind: 'curse' },
];

export function parseIntercessions(common: CommonExtraction): DeityIntercession[] {
  const body = findSectionBody(common, 'Divine Intercession');
  if (body === '') return [];
  const map = harvestLinkedBoldLabels(body);
  const out: DeityIntercession[] = [];
  for (const { label, tier, kind } of INTERCESSION_TIERS) {
    const text = map.get(label);
    if (text === undefined || text === '') continue;
    out.push({ tier, kind, text });
  }
  return out;
}

/** Harvest deity-to-deity cross references from the page body. */
export function parseDeityRelationships(
  common: CommonExtraction,
  extractEntityId: (url: string) => number | null,
): DeityRelationship[] {
  const out: DeityRelationship[] = [];
  const seen = new Set<string>();
  for (const link of common.links) {
    if (link.kind !== 'Deities') continue;
    if (link.text === '' || seen.has(link.href)) continue;
    // Skip self-references (the page often links to its own legacy version).
    if (link.id !== null && link.id === extractEntityId(common.url)) continue;
    seen.add(link.href);
    out.push({ name: link.text, deity_id: link.id, href: link.href });
  }
  return out;
}
