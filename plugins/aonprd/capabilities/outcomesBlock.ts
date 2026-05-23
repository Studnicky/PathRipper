/**
 * Outcomes block parser capability.
 *
 * Unified extraction of Critical Success / Success / Failure / Critical Failure
 * outcome blocks from HTML fragments. This is a shared Layer-1 helper used by
 * spell, ritual, action, camp-activity, and hazard concepts.
 *
 * Each concept specifies *which* body fragment to parse (description, effect, etc.);
 * this module provides the *how* — the common outcome-block parsing algorithm.
 */

import { htmlToText } from '../common.js';

/**
 * Outcomes interface — shared across spell, ritual, action, and hazard concepts.
 * camp-activity uses a slightly different shape (array of {tier, text} objects);
 * see outcomesBlockToCampActivity() for conversion.
 */
export interface Outcomes {
  critical_success: string | null;
  success: string | null;
  failure: string | null;
  critical_failure: string | null;
}

/**
 * Parse a four-tier outcome block from an HTML fragment.
 *
 * Scans for `<b>Critical Success</b>`, `<b>Success</b>`, `<b>Failure</b>`,
 * and `<b>Critical Failure</b>` markers, extracting the text body that follows
 * each marker until the next marker, `<hr />`, or end of fragment.
 *
 * Returns all four outcomes (null if marker not found or body is empty after
 * htmlToText conversion).
 */
export function parseOutcomesBlock(bodyHtml: string): Outcomes {
  const labels: Array<{ key: keyof Outcomes; pattern: RegExp }> = [
    { key: 'critical_success', pattern: /<b>\s*Critical\s+Success\s*<\/b>/i },
    { key: 'success', pattern: /<b>\s*Success\s*<\/b>/i },
    { key: 'failure', pattern: /<b>\s*Failure\s*<\/b>/i },
    { key: 'critical_failure', pattern: /<b>\s*Critical\s+Failure\s*<\/b>/i },
  ];

  const out: Outcomes = {
    critical_success: null,
    success: null,
    failure: null,
    critical_failure: null,
  };

  // Determine scope: stop at first <hr /> (some concepts use it as a boundary).
  const hrIdx = /<hr\s*\/?>/i.exec(bodyHtml);
  const scope = hrIdx === null ? bodyHtml : bodyHtml.slice(0, hrIdx.index);

  for (const { key, pattern } of labels) {
    const m = pattern.exec(scope);
    if (m === null) continue;

    const after = m.index + m[0].length;
    const body = readTierBody(scope, after);
    const text = htmlToText(body);
    out[key] = text === '' ? null : text;
  }

  return out;
}

/**
 * Extract text body following a tier marker until the next tier/`<hr/>`/end.
 *
 * Internal helper used by parseOutcomesBlock.
 */
function readTierBody(html: string, after: number): string {
  const stop = /<b>\s*(?:Critical\s+Success|Success|Failure|Critical\s+Failure|Heightened)\b|<hr\s*\/?>/i;
  const slice = html.slice(after);
  const m = stop.exec(slice);
  const end = m === null ? slice.length : m.index;
  return slice.slice(0, end);
}

/**
 * Convert an Outcomes object to camp-activity format: array of {tier, text} objects.
 *
 * camp-activity returns only the outcomes present (null values are omitted).
 */
export function outcomesBlockToCampActivity(
  outcomes: Outcomes,
): Array<{ tier: 'critical-success' | 'success' | 'failure' | 'critical-failure'; text: string }> {
  const mapping: Array<{
    key: keyof Outcomes;
    tier: 'critical-success' | 'success' | 'failure' | 'critical-failure';
  }> = [
    { key: 'critical_success', tier: 'critical-success' },
    { key: 'success', tier: 'success' },
    { key: 'failure', tier: 'failure' },
    { key: 'critical_failure', tier: 'critical-failure' },
  ];

  const out: Array<{ tier: 'critical-success' | 'success' | 'failure' | 'critical-failure'; text: string }> = [];
  for (const { key, tier } of mapping) {
    const text = outcomes[key];
    if (text !== null) {
      out.push({ tier, text });
    }
  }
  return out;
}
