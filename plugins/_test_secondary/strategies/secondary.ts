// Secondary-source Layer-1 strategy — Wave 5 proof-of-concept.
//
// This file deliberately imports ONLY framework-level interfaces from
// `plugins/aonprd/capabilities/strategy.ts` (which itself is plugin-agnostic)
// plus `cheerio`/`domhandler`. It must not import from any AON-specific
// module — that's the type-check enforced by the constraint "a strategy can
// be defined with NO imports from `plugins/aonprd/<non-capabilities>`".
//
// H15 — source-citation strategy: reads `<div class="citation">` blocks with
//   `data-source-id` and `data-page` attributes instead of the AON
//   `<b>Source</b>` + `Sources.aspx?ID=` pattern.
// H16 — section-walker strategy: walks bare `<h2>` / `<h3>` tags with no
//   class filter (vs the AON `h2.title, h3.title` selector).
import type { CheerioAPI } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';

import type {
  CommonStrategy,
  Section,
  SourceRef,
  LinkRef,
  CheerioTarget,
} from '../../../src/types/ExtractionStrategy.js';

/**
 * Strip HTML tags and collapse whitespace. Mirrored from `common.ts:htmlToText`
 * but kept local so this strategy has zero imports from AON-specific modules.
 */
function htmlToTextLocal(html: string): string {
  let s = html.replace(/<br\s*\/?>/gi, ' ');

  // Strip tags to fixpoint so nested/malformed tags cannot survive a single pass
  // (CWE-116 / js/incomplete-multi-character-sanitization).
  let prev: string;
  do {
    prev = s;
    s = s.replace(/<[^>]+>/g, '');
  } while (s !== prev);

  // Decode &amp; last so &amp;nbsp; etc. never double-unescape.
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g,  '&')
    .replace(/\s+/g,    ' ')
    .trim();
}

/** Harvest plain `<a href>` cross-references inside an HTML fragment. */
function harvestLinksLocal(fragmentHtml: string): LinkRef[] {
  const out: LinkRef[] = [];
  if (fragmentHtml === '') return out;
  const anchorRe = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((match = anchorRe.exec(fragmentHtml)) !== null) {
    const href = match[1] ?? '';
    const text = htmlToTextLocal(match[2] ?? '');
    const key = `${href}|${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Derive a "kind" token from the last path segment of the URL — non-AON
    // sources do not have a `.aspx` filename to key off.
    const kindMatch = /\/([A-Za-z0-9_-]+)(?:\.[a-z]+)?(?:[?#]|$)/.exec(href);
    out.push({
      href,
      text,
      kind: kindMatch?.[1] ?? 'link',
      id:   null,
    });
  }
  return out;
}

export const secondaryStrategy: CommonStrategy = {
  // H15 — sources are emitted as `<div class="citation" data-source-id=N
  // data-page=N>Title</div>` blocks anywhere inside the content target.
  sourceRef: {
    extractSources(target: CheerioTarget, root: CheerioAPI): SourceRef[] {
      const out: SourceRef[] = [];
      const seen = new Set<string>();
      target.find('div.citation').each((_index, element) => {
        const node = element as Element;
        const sourceIdRaw = node.attribs?.['data-source-id'];
        const pageRaw     = node.attribs?.['data-page'];
        const source_id = sourceIdRaw !== undefined ? parseInt(sourceIdRaw, 10) : null;
        const page      = pageRaw     !== undefined ? parseInt(pageRaw, 10)     : null;
        const text  = htmlToTextLocal(root.html(element as AnyNode) ?? '');
        const book  = text === '' ? null : text;
        const key = `${source_id ?? 'n'}|${book ?? ''}|${page ?? 'n'}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({
          book,
          page:      Number.isFinite(page)      ? page      : null,
          source_id: Number.isFinite(source_id) ? source_id : null,
          raw:       text,
        });
      });
      return out;
    },
  },

  // H16 — sections are bare `<h2>` / `<h3>` headings (no `.title` class
  // required). Body text/html runs until the next h1/h2/h3 sibling.
  sectionWalker: {
    harvestSections(root: CheerioAPI, target: CheerioTarget): Section[] {
      const out: Section[] = [];
      target.find('h2, h3').each((_index, element) => {
        const node = element as Element;
        const $heading = root(element);
        const tag = node.tagName.toLowerCase();
        const level: 2 | 3 = tag === 'h3' ? 3 : 2;
        const heading = $heading.text().replace(/\s+/g, ' ').trim();
        if (heading === '') return;

        const fragments: string[] = [];
        let cur = node.next as AnyNode | null;
        while (cur !== null) {
          if (cur.type === 'tag') {
            const next = cur as Element;
            const nextTag = next.tagName.toLowerCase();
            if (nextTag === 'h1' || nextTag === 'h2' || nextTag === 'h3') break;
          }
          fragments.push(root.html(cur as AnyNode));
          cur = (cur as { next: AnyNode | null }).next;
        }
        const body_html = fragments.join('');
        out.push({
          heading,
          level,
          body_html,
          body_text: htmlToTextLocal(body_html),
          links:     harvestLinksLocal(body_html),
        });
      });
      return out;
    },
  },
};
