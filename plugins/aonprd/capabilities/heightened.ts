/**
 * Heightened block parser capability.
 *
 * Unified extraction of `<b>Heightened (LABEL)</b>` variant blocks from HTML
 * fragments. This is a shared Layer-1 helper used by spell and ritual concepts.
 *
 * Each concept specifies *which* body fragment to parse (spell body, ritual body);
 * this module provides the *how* — the common heightened-block parsing algorithm.
 */

import { htmlToText } from '../common.js';

/** Ordinal-to-number mapping (1st → 1, 5th → 5, etc). */
const ORDINAL_MAP: ReadonlyMap<string, number> = new Map<string, number>([
  ['1st', 1], ['2nd', 2], ['3rd', 3], ['4th', 4], ['5th', 5],
  ['6th', 6], ['7th', 7], ['8th', 8], ['9th', 9], ['10th', 10],
]);

/**
 * Heightened entry — shared across spell and ritual concepts.
 *
 * Represents a single `<b>Heightened (LABEL)</b>` variant block with parsed
 * rank/increment and both HTML and text renderings of the body.
 */
export interface HeightenedEntry {
  /** Raw label text as it appeared in the `(…)` parenthetical. */
  rank_label: string;
  /** Numeric rank when label is an ordinal like "5th" or numeric like "5". */
  rank: number | null;
  /** Numeric increment when label is `+N` format. */
  increment: number | null;
  /** Body text with HTML tags stripped. */
  body_text: string;
  /** Verbatim HTML between this marker and the next Heightened, end of body, or end of fields. */
  body_html: string;
}

/**
 * Convert a heightened rank label like "5th" or "+2" to numeric rank/increment.
 *
 * Internal helper used by parseHeightened.
 */
function parseHeightenedLabel(label: string): { rank: number | null; increment: number | null } {
  const trimmed = label.trim();
  const incM = /^\+\s*(\d+)$/.exec(trimmed);
  if (incM !== null) {
    const num = parseInt(incM[1] ?? '', 10);
    return { rank: null, increment: Number.isFinite(num) ? num : null };
  }
  const ord = ORDINAL_MAP.get(trimmed.toLowerCase());
  if (ord !== undefined) return { rank: ord, increment: null };
  const numM = /^(\d+)/.exec(trimmed);
  if (numM !== null) {
    const num = parseInt(numM[1] ?? '', 10);
    return { rank: Number.isFinite(num) ? num : null, increment: null };
  }
  return { rank: null, increment: null };
}

/**
 * Parse heightened blocks from an HTML fragment.
 *
 * Scans for every `<b>Heightened (LABEL)</b>` marker in source order, extracting
 * the body that follows each marker until the next Heightened marker, `<hr />`,
 * or end of fragment. Drops trailing empty `<ul></ul>` placeholders.
 *
 * Returns all heightened entries found (empty array if no markers present).
 */
export function parseHeightened(bodyHtml: string): HeightenedEntry[] {
  const out: HeightenedEntry[] = [];
  const regex = /<b>\s*Heightened\s*\(([^)]+)\)\s*<\/b>/gi;
  const matches: Array<{ label: string; index: number; end: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(bodyHtml)) !== null) {
    matches.push({ label: (match[1] ?? '').trim(), index: match.index, end: match.index + match[0].length });
  }
  for (let index = 0; index < matches.length; index++) {
    const cur = matches[index]!;
    const next = matches[index + 1];
    const end = next === undefined ? bodyHtml.length : next.index;
    const seg = bodyHtml.slice(cur.end, end);
    // Drop trailing decorative `<ul></ul>` placeholders.
    const cleaned = seg.replace(/<ul>\s*<\/ul>/gi, '').trim();
    const { rank, increment } = parseHeightenedLabel(cur.label);
    out.push({
      rank_label: cur.label,
      rank,
      increment,
      body_html: cleaned,
      body_text: htmlToText(cleaned),
    });
  }
  return out;
}
