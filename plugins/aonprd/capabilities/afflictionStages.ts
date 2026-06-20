/**
 * Affliction stages parser capability.
 *
 * Unified extraction of `<b>Stage N</b>` progression markers from HTML fragments.
 * This is a shared Layer-1 helper used by curse, disease, spell, and weather-hazard concepts.
 *
 * Each concept specifies *which* body fragment to parse (affliction block, spell body);
 * this module provides the *how* — the common affliction-stages parsing algorithm.
 */

import { htmlToText } from '../common.js';

/**
 * Affliction stage — shared across curse, disease, spell, and weather-hazard concepts.
 *
 * Represents a single `<b>Stage N</b>` progression step with body text and optional duration.
 */
export interface AfflictionStage {
  /** Stage number parsed from the `<b>Stage N</b>` marker. */
  stage: number;
  /** Prose body with HTML tags stripped. */
  body_text: string;
  /** Optional `(duration)` parenthetical such as "1 day", "1 round". */
  duration: string | null;
}

/**
 * Parse affliction stages from an HTML fragment.
 *
 * Scans for every `<b>Stage N</b>` marker, extracting the body that follows each
 * marker until the next Stage marker, `<hr />`, heading, or end of fragment.
 * The trailing `(…)` parenthetical, if any, is lifted into `duration`; the
 * remaining text becomes `body_text`.
 *
 * Returns all stages found in source order (empty array if no Stage markers present).
 */
export function parseAfflictionStages(html: string): AfflictionStage[] {
  const out: AfflictionStage[] = [];

  // Stages can't cross a boundary (hr or heading). Cut the scope at the
  // first boundary so subsequent Stage markers behind the boundary aren't
  // emitted (e.g. spell page that has stages followed by a heading + later
  // examples).
  const stopRe = /<hr\s*\/?>|<h[1-6]\b/i;
  const stopMatch = stopRe.exec(html);
  const scope = stopMatch !== null ? html.slice(0, stopMatch.index) : html;

  const regex = /<b>\s*Stage\s+(\d+)\s*<\/b>/gi;
  const matches: Array<{ stage: number; index: number; end: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(scope)) !== null) {
    const stage = parseInt(match[1] ?? '0', 10);
    if (Number.isFinite(stage)) {
      matches.push({ stage, index: match.index, end: match.index + match[0].length });
    }
  }
  if (matches.length === 0) return out;

  for (let index = 0; index < matches.length; index++) {
    const cur = matches[index]!;
    const next = matches[index + 1];
    const endIdx = next !== undefined ? next.index : scope.length;
    const segHtml = scope.slice(cur.end, endIdx);
    // Strip leading punctuation/whitespace + trailing whitespace, but preserve
    // sentence-final periods inside the body (those belong to body_text).
    const text = htmlToText(segHtml).replace(/^[\s;:.]+|\s+$/g, '');

    let duration: string | null = null;
    let body_text = text;
    // Trailing `(…)` parenthetical is the duration. The closing `)` must be
    // the last non-whitespace character (allowing an optional trailing
    // separator like `;` after — but NOT consuming the body's terminating
    // period: `damage. (1 day)` → body=`damage.`, duration=`1 day`.
    const durM = /\(([^()]+)\)\s*;?\s*$/.exec(text);
    if (durM !== null) {
      duration = (durM[1] ?? '').trim();
      body_text = text.slice(0, durM.index).trimEnd();
    }
    out.push({ stage: cur.stage, body_text, duration });
  }
  return out;
}
