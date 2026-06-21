// Capability: extract:linked-anchor-list
// Helper that parses a comma-separated `<a href>` list from HTML.
// Used for: language speakers, deity edicts/anathema, source related-entries.
//
// No NodeInterface (pure helper). Consumers call this directly to extract
// anchor-ref arrays from any HTML fragment.

import { htmlToText } from '../common.js';

/** Reference to an anchor with resolved ID. */
export interface AnchorRef {
  /** Display text of the anchor. */
  name: string;
  /** Verbatim href attribute. */
  href: string;
  /** Numeric ID extracted from the href query string, or null. */
  aon_id: number | null;
}

/**
 * Parse a comma-separated `<a href>` list from HTML.
 *
 * Splits on commas and processes each anchor element. Returns an array of
 * AnchorRef objects with name, href, and extracted aon_id (from query string).
 *
 * @param html HTML fragment containing comma-separated `<a>` elements
 * @returns Array of AnchorRef objects in source order
 */
export function parseLinkedAnchorList(html: string): AnchorRef[] {
  if (html.trim() === '') return [];

  const out: AnchorRef[] = [];

  // Split on commas while respecting HTML boundaries.
  // Simple regex approach: find every `<a>…</a>` and yield it + the tail until the next comma.
  const anchorRe = /<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorRe.exec(html)) !== null) {
    const href = match[1] ?? '';
    const innerHtml = match[2] ?? '';
    const name = htmlToText(innerHtml).trim();
    if (name === '') continue;

    // Extract numeric ID from href query string (e.g. `?ID=123`).
    const idMatch = /[?&]ID=(\d+)/i.exec(href);
    const aon_id = idMatch !== null ? parseInt(idMatch[1]!, 10) : null;

    out.push({
      name,
      href,
      aon_id: Number.isFinite(aon_id) ? aon_id : null,
    });
  }

  return out;
}
