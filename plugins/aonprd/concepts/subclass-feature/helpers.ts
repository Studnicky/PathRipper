// Subclass-feature concept — parsing helpers.
import { htmlToText } from '../../common.js';
import type {
  SubclassFeatureSpellRef,
  SubclassFeatureSpellGroup,
  SubclassFeatureGrantedFeature,
} from './types.js';
import {
  URL_KIND_INFO,
  SPELL_LIST_HEADINGS,
  STRUCTURED_HEADING_LABELS,
  RANK_TOKEN_RE,
} from './types.js';

// ─── URL-kind → {subclass_family, parent_class} resolution ───────────────────

/**
 * Extract the URL kind (lowercase `.aspx` filename) from an AON URL.
 * Returns `null` when no `.aspx` segment is present.
 */
export function detectUrlKind(url: string): string | null {
  const m = /\/([A-Za-z]+)\.aspx/.exec(url);
  return m === null ? null : m[1]!.toLowerCase();
}

/** Resolve `{subclass_family, parent_class}` for a URL. Fallback: family = url kind, class = null. */
export function resolveFamily(url: string): { subclass_family: string; parent_class: string | null } {
  const kind = detectUrlKind(url);
  if (kind === null) return { subclass_family: 'unknown', parent_class: null };
  const info = URL_KIND_INFO.get(kind);
  if (info !== undefined) return { subclass_family: info.subclass_family, parent_class: info.parent_class };
  return { subclass_family: kind, parent_class: null };
}

// ─── Spell list parsing ────────────────────────────────────────────────────────

/**
 * Parse a comma/semicolon-separated rank-tagged spell list out of a fragment.
 *
 * Examples:
 *   `cantrip: <a>daze</a>, 1st: <a>phantom pain</a>, 2nd: <a>stupefy</a>` →
 *     `[{ rank: 'cantrip', spells: [daze] }, { rank: '1st', spells: [phantom pain] }, …]`
 *   `initial: <a>life link</a>, advanced: <a>delay affliction</a>` →
 *     `[{ rank: 'initial', … }, { rank: 'advanced', … }]`
 *
 * Returns an empty array when no rank tokens are present.
 */
export function parseRankedSpellList(html: string): SubclassFeatureSpellGroup[] {
  if (html === '') return [];

  // Find every rank token and its position. We split the HTML on those
  // positions so each segment captures the spells that follow until the next
  // rank token (or end).
  const ranks: Array<{ token: string; start: number; end: number }> = [];
  RANK_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RANK_TOKEN_RE.exec(html)) !== null) {
    const tokenRaw = m[1] ?? '';
    if (tokenRaw === '') continue;
    // m.index points at the preceding whitespace/punctuation; advance past it.
    const labelStart = m.index + m[0].indexOf(tokenRaw);
    const labelEnd   = m.index + m[0].length;
    ranks.push({ token: tokenRaw.toLowerCase(), start: labelStart, end: labelEnd });
  }
  if (ranks.length === 0) return [];

  const out: SubclassFeatureSpellGroup[] = [];
  for (let i = 0; i < ranks.length; i++) {
    const cur = ranks[i]!;
    const next = i + 1 < ranks.length ? ranks[i + 1]!.start : html.length;
    const segment = html.slice(cur.end, next);
    const spells: SubclassFeatureSpellRef[] = [];
    const anchorRe = /<a\b[^>]*href="([^"]*Spells\.aspx[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    let am: RegExpExecArray | null;
    while ((am = anchorRe.exec(segment)) !== null) {
      const href      = am[1] ?? '';
      const innerText = htmlToText(am[2] ?? '');
      if (innerText === '') continue;
      const idMatch  = /\?ID=(\d+)/i.exec(href);
      const spell_id = idMatch !== null ? parseInt(idMatch[1]!, 10) : null;
      spells.push({ name: innerText, spell_id });
    }
    if (spells.length === 0) {
      // Fallback: split bare text on commas when no anchors are present.
      const plain = htmlToText(segment).replace(/^[\s:;,]+|[\s;,]+$/g, '');
      if (plain !== '') {
        for (const piece of plain.split(/[,;]/)) {
          const name = piece.trim();
          if (name !== '') spells.push({ name, spell_id: null });
        }
      }
    }
    out.push({ rank: cur.token, spells });
  }
  return out;
}

// ─── Bold-label harvesting ────────────────────────────────────────────────────

/**
 * Harvest `<b>Label</b> Value` pairs from a fragment, supporting labels that
 * wrap an inner `<a>` (e.g. `<b><a href="…">Spell List</a></b>`). Returns a
 * case-insensitive Map keyed by the inner text of the `<b>`, with the verbatim
 * value HTML captured up to the next `<b>` boundary or end of fragment.
 *
 * `<br>` separators are tolerated by the lookahead — they don't terminate the
 * value (mirroring `deity.ts`'s harvester).
 */
export function harvestBoldLabels(html: string): Map<string, { text: string; raw_html: string }> {
  const out = new Map<string, { text: string; raw_html: string }>();
  const re = /<b>([\s\S]*?)<\/b>([\s\S]*?)(?=<b>|<h[1-6]\b|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const labelHtml = m[1] ?? '';
    const valueHtml = m[2] ?? '';
    const label = htmlToText(labelHtml).replace(/[:?]$/, '').trim();
    if (label === '') continue;
    const text = htmlToText(valueHtml).replace(/^[\s;,:]+|[\s;,]+$/g, '');
    const key = label.toLowerCase();
    if (out.has(key)) continue;
    out.set(key, { text, raw_html: valueHtml.trim() });
  }
  return out;
}

// ─── Feature heading parsing ──────────────────────────────────────────────────

/** Trim a level token off a granted-feature heading: `"3rd Bloodline Spell"` → `{ level: 3, name: 'Bloodline Spell' }`. */
export function parseFeatureHeading(heading: string): { name: string; level: number | null } {
  const m = /^(\d+)(?:st|nd|rd|th)\s+(.*)$/i.exec(heading.trim());
  if (m !== null) {
    const lvl = parseInt(m[1]!, 10);
    return { name: m[2]!.trim(), level: Number.isFinite(lvl) ? lvl : null };
  }
  return { name: heading.trim(), level: null };
}

// ─── Body region parsing ──────────────────────────────────────────────────────

/**
 * Locate the head region of `body_html` — everything before the first
 * granted-feature block.
 *
 * Modern layout: granted features are `<div class="subclass-feature">` blocks
 * we want to exclude wholesale.
 *
 * Legacy layout: header fields (Spell List, Patron Skill, Usage, …) and
 * granted features (Lesson of …, Familiar of …, …) all live as `<b>Label</b>`
 * pairs. AON separates the two groups with a `<br><br>` pair. We split at the
 * LAST `<br><br>` that precedes a `<b>` label whose value spans more than a
 * single line — that label marks the first granted feature.
 */
export function bodyHeadRegion(bodyHtml: string): string {
  const m = /<div\s+class="subclass-feature[^"]*"/i.exec(bodyHtml);
  if (m !== null) return bodyHtml.slice(0, m.index);
  // Legacy: locate `<br><br>` separators bracketing `<b>` blocks. The head
  // contains short single-line labels (no inner `<br><br>` in their values);
  // the features section starts at the separator BEFORE the first long-body
  // label or at end of body when no long-body label exists.
  const sepRe = /<br\s*\/?>\s*<br\s*\/?>/gi;
  const seps: number[] = [];
  let m2: RegExpExecArray | null;
  while ((m2 = sepRe.exec(bodyHtml)) !== null) seps.push(m2.index + m2[0].length);
  if (seps.length === 0) return bodyHtml;
  // Pick the boundary that splits short labels from long-body labels: walk
  // separators left-to-right, the head ends at the separator AFTER which the
  // next `<b>` label has a value spanning the rest of the body (i.e. no
  // `<br><br>` inside its value).
  let headEnd = seps[0]!;
  for (let i = 0; i < seps.length - 1; i++) {
    const start = seps[i]!;
    const end   = seps[i + 1]!;
    const chunk = bodyHtml.slice(start, end);
    // Header-field chunk: contains a `<b>` label whose value is single-line.
    if (/<b>/i.test(chunk)) headEnd = end;
  }
  return bodyHtml.slice(0, headEnd);
}

/**
 * Locate the granted-feature region of `body_html` — everything after the
 * head region.
 */
export function bodyFeaturesRegion(bodyHtml: string): string {
  const m = /<div\s+class="subclass-feature[^"]*"/i.exec(bodyHtml);
  if (m !== null) return bodyHtml.slice(m.index);
  const head = bodyHeadRegion(bodyHtml);
  return bodyHtml.slice(head.length);
}

// ─── Flavor label detection ───────────────────────────────────────────────────

/**
 * Some subclass pages embed bold NPC names and one-off ability cards inside
 * flavor prose (`<b>Arba Dwindletree</b> taught you…`, `<b>Positive Energy
 * Expulsion</b> …`). They are not structured data — strip them with a
 * Title-Case proper-name heuristic that ignores the CLAIMED list entries
 * (since those are already removed by `stripStructuredKeys`).
 */
export function isFlavorBoldLabel(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length < 3) return false;
  // Strip trailing parenthetical qualifier.
  const core = trimmed.replace(/\s*\([^)]*\)\s*$/, '').trim();
  if (core.length < 3) return false;
  // Adventure-product ID code (e.g. "SC- 04910") — alphabetic prefix + digits.
  if (/^[A-Z]{1,4}[-\s]\s*\d+$/.test(core)) return true;
  // Multi-word Title-Case with optional lowercase connector words.
  if (/^[A-Z][A-Za-z'.\-]*(?:[ '\-](?:[a-z]{1,4}|[A-Z][A-Za-z'.\-]*))+$/.test(core)) return true;
  // Single-word Title-Case proper name (3+ chars: Hew, Gal, Roc, Moloch).
  if (/^[A-Z][a-z]{2,}$/.test(core)) return true;
  return false;
}
